import os
import base64
import hashlib
import json
import logging
import random
import re
import time
import urllib.parse
import uuid as _uuid

from instagrapi import Client
from instagrapi.exceptions import ChallengeRequired, TwoFactorRequired

logger = logging.getLogger(__name__)

TWOCAPTCHA_KEY = os.getenv('TWOCAPTCHA_API_KEY', '')


def _normalize_proxy(proxy: str | None) -> str | None:
    """Normalize proxy to http://user:pass@host:port regardless of input format."""
    if not proxy:
        return None
    proxy = proxy.strip()
    if proxy.startswith(('http://', 'https://', 'socks5://', 'socks4://')):
        return proxy
    # user:pass@host:port  →  http://user:pass@host:port
    if '@' in proxy:
        return f'http://{proxy}'
    # host:port:user:pass  →  http://user:pass@host:port
    parts = proxy.split(':')
    if len(parts) == 4:
        host, port, user, password = parts
        return f'http://{user}:{password}@{host}:{port}'
    # host:port  →  http://host:port
    return f'http://{proxy}'


# Кеш «сырая строка прокси → рабочий URL со схемой» на время жизни процесса воркера,
# чтобы не пробовать протокол заново на каждом действии поллинга.
_proxy_scheme_cache: dict[str, str] = {}

# Кеш репутации прокси (успешные результаты check_proxy) — чтобы не дёргать чекер
# на каждом подключении аккаунта при массовом импорте.
_proxy_rep_cache: dict[str, dict] = {}
_PROXY_REP_TTL = 1800.0  # сек — сколько доверяем закешированной проверке прокси (30 мин)


def _resolve_proxy_scheme(proxy: str | None) -> str | None:
    """Определить РАБОЧУЮ схему прокси (http / socks5 / socks4) пробным подключением и
    вернуть готовый URL со схемой. Продавцы часто дают одну строку host:port:user:pass,
    не указывая протокол — тут он определяется сам. Если пользователь задал схему явно
    (socks5://…) — используем как есть. Результат кешируется на процесс."""
    if not proxy:
        return None
    key = proxy.strip()
    if key in _proxy_scheme_cache:
        return _proxy_scheme_cache[key]
    base = _normalize_proxy(key)  # http://user:pass@host:port (или уже со схемой)
    if not base:
        return None
    # Явно заданная не-http схема — доверяем без проб
    if base.startswith(('socks5://', 'socks5h://', 'socks4://', 'https://')):
        _proxy_scheme_cache[key] = base
        return base
    import requests
    hostpart = base.split('://', 1)[1]  # user:pass@host:port
    candidates = [base, f'socks5://{hostpart}', f'socks4://{hostpart}']  # http → socks5 → socks4
    for url in candidates:
        try:
            requests.get('https://api.ipify.org?format=json',
                         proxies={'http': url, 'https': url}, timeout=10)
            _proxy_scheme_cache[key] = url
            logger.info("Proxy scheme resolved: %s → %s", key.split(':')[0], url.split('://')[0])
            return url
        except Exception:
            continue
    # Ни одна схема не подключилась — вернём http (вызывающий получит понятную ProxyError)
    return base


def _check_proxy_uncached(proxy: str | None = None) -> dict:
    """Проверить прокси: вернуть исходящий IP, страну, провайдера И вердикт по репутации
    (датацентр / VPN / прокси / мобильный) — как это видит Instagram. Без proxy — IP сервера.

    Основной сервис — ipapi.is (без ключа отдаёт флаги is_datacenter/is_vpn/is_proxy/is_mobile
    + компанию/тип). Запрос идём ЧЕРЕЗ прокси без параметра — сервис видит именно исходящий IP
    прокси и возвращает его репутацию за один вызов. Фолбэк — ipinfo/ip-api (только IP/ISP)."""
    import requests
    norm = _resolve_proxy_scheme(proxy)  # авто-схема: http / socks5 / socks4
    proxies = {"http": norm, "https": norm} if norm else None
    scheme = norm.split('://', 1)[0] if norm else 'direct'

    # 1) ipapi.is — IP + флаги репутации за один запрос через прокси
    try:
        r = requests.get("https://api.ipapi.is/", proxies=proxies, timeout=25)
        j = r.json()
        company = j.get("company") or {}
        asn = j.get("asn") or {}
        loc = j.get("location") or {}
        isp = company.get("name") or asn.get("org") or asn.get("descr") or ""
        res = {
            "ok": True, "proxyUsed": bool(norm), "scheme": scheme,
            "ip": j.get("ip", ""),
            "country": loc.get("country") or loc.get("country_code") or "",
            "isp": isp,
            "companyType": company.get("type") or "",
            "datacenter": bool(j.get("is_datacenter")),
            "vpn": bool(j.get("is_vpn")),
            "proxy": bool(j.get("is_proxy")),
            "mobile": bool(j.get("is_mobile")),
        }
        logger.info("check_proxy: scheme=%s ip=%s country=%s dc=%s vpn=%s mobile=%s isp=%s",
                    scheme, res["ip"], res["country"], res["datacenter"], res["vpn"], res["mobile"], isp)
        return res
    except Exception as e:
        logger.warning("check_proxy ipapi.is failed: %s", e)

    # 2) Фолбэк: только IP/страна/ISP (без флагов репутации)
    last_err = None
    for url in ["https://ipinfo.io/json", "http://ip-api.com/json"]:
        try:
            r = requests.get(url, proxies=proxies, timeout=20)
            j = r.json()
            return {
                "ok": True, "proxyUsed": bool(norm), "scheme": scheme,
                "ip": j.get("ip") or j.get("query") or "",
                "country": j.get("country") or j.get("countryCode") or "",
                "isp": j.get("org") or j.get("isp") or j.get("as") or "",
                "datacenter": None, "vpn": None, "proxy": None, "mobile": None,
            }
        except Exception as e:
            last_err = e
            logger.warning("check_proxy via %s failed: %s", url, e)
    return {"ok": False, "proxyUsed": bool(norm), "scheme": scheme, "error": f"{type(last_err).__name__}: {last_err}"}


def check_proxy(proxy: str | None = None, use_cache: bool = False) -> dict:
    """Обёртка с кешем поверх _check_proxy_uncached. use_cache=True — берём недавний
    успешный результат из _proxy_rep_cache (для подбора прокси при подключении/импорте,
    чтобы не дёргать чекер на каждый аккаунт). «Проверить IP» вызывает без кеша — всегда свежо."""
    norm = _resolve_proxy_scheme(proxy)
    key = norm or 'direct'
    if use_cache:
        c = _proxy_rep_cache.get(key)
        if c and (time.time() - c.get('_ts', 0)) < _PROXY_REP_TTL:
            return {k: v for k, v in c.items() if k != '_ts'}
    res = _check_proxy_uncached(proxy)
    if use_cache and res.get('ok'):
        _proxy_rep_cache[key] = {**res, '_ts': time.time()}
    return res


def pick_best_proxy(candidates: list[str]) -> dict:
    """Из списка прокси-кандидатов выбрать РАБОЧИЙ, предпочитая «чистый» по репутации.
    Мёртвые (не коннектятся) пропускаем. Флаг datacenter/vpn от чекеров НЕнадёжен
    (ISP-прокси часто ложно метятся как DC), поэтому это лишь мягкий приоритет: если
    чистых нет — берём рабочий флагнутый (flagged=True). chosen=None — все мертвы."""
    alive_any: str | None = None
    checked: list[dict] = []
    for url in candidates:
        rep = check_proxy(url, use_cache=True)
        checked.append({
            "url": url, "ok": bool(rep.get("ok")), "ip": rep.get("ip", ""),
            "country": rep.get("country", ""),
            "datacenter": rep.get("datacenter"), "vpn": rep.get("vpn"),
        })
        if not rep.get("ok"):
            continue  # мёртвый прокси — пропускаем
        flagged = bool(rep.get("datacenter") or rep.get("vpn") or rep.get("proxy"))
        if not flagged:
            return {"chosen": url, "flagged": False, "checked": checked}  # живой и чистый — лучший
        if alive_any is None:
            alive_any = url
    if alive_any:
        return {"chosen": alive_any, "flagged": True, "checked": checked}
    return {"chosen": None, "flagged": False, "checked": checked}


# In-memory store for pending challenge sessions: username → {settings, api_path, proxy}
_challenge_sessions: dict[str, dict] = {}

# Instagram reCAPTCHA site key (used in challenge pages)
_IG_RECAPTCHA_SITEKEY = '6LenUD0UAAAAABGHhh5oqMVnHlC2tDHWwHkM79Nl'


# Дефолтное устройство instagrapi — используется, только если User-Agent не удалось
# распознать (лишь бы в device_settings всегда был app_version и остальные ключи).
_DEFAULT_DEVICE = {
    "app_version": "269.0.0.18.75",
    "android_version": 26,
    "android_release": "8.0.0",
    "dpi": "480dpi",
    "resolution": "1080x1920",
    "manufacturer": "OnePlus",
    "device": "devitron",
    "model": "6T Dev",
    "cpu": "qcom",
    "version_code": "314665256",
}


# ─── Стабильный отпечаток устройства на аккаунт ──────────────────────────────
# Урок из антибан-аудита похожего Playwright-бота (autofacebook, BAN-1/BAN-11):
# «то же самое железо, но новый отпечаток при каждой попытке» — сигнал фермы аккаунтов
# сильнее, чем просто плохой прокси. Реальный телефон не меняется от входа к входу.
# Раньше login_by_credentials/login_by_cookies создавали пустой Client() и instagrapi
# сам генерировал СЛУЧАЙНОЕ устройство/uuid при каждом вызове — при ретрае (challenge,
# неверный код, повторный импорт) аккаунт «менял телефон» посреди попытки логина.
# Здесь устройство/uuid детерминированы по username — тот же «телефон» на каждый вход,
# ретрай и будущий ре-логин того же аккаунта, а у разных аккаунтов — разные.
_DEVICE_POOL = [
    {"manufacturer": "samsung", "model": "SM-G991B", "device": "o1s",         "cpu": "exynos2100", "dpi": "560dpi", "resolution": "1440x3200", "android_version": 31, "android_release": "12"},
    {"manufacturer": "samsung", "model": "SM-A525F", "device": "a52q",       "cpu": "qcom",       "dpi": "393dpi", "resolution": "1080x2400", "android_version": 30, "android_release": "11"},
    {"manufacturer": "xiaomi",  "model": "M2101K6G", "device": "spes",       "cpu": "qcom",       "dpi": "440dpi", "resolution": "1080x2400", "android_version": 30, "android_release": "11"},
    {"manufacturer": "OnePlus", "model": "IN2020",   "device": "OnePlus8Pro","cpu": "qcom",       "dpi": "560dpi", "resolution": "1440x3168", "android_version": 29, "android_release": "10"},
    {"manufacturer": "google",  "model": "Pixel 6",  "device": "oriole",     "cpu": "exynos",     "dpi": "420dpi", "resolution": "1080x2400", "android_version": 32, "android_release": "12"},
    {"manufacturer": "huawei",  "model": "ELS-NX9",  "device": "HWELS",      "cpu": "kirin990",   "dpi": "480dpi", "resolution": "1200x2640", "android_version": 29, "android_release": "10"},
]
_UUID_NS = _uuid.UUID('6f9619ff-8b86-d011-b42d-00c04fc964ff')  # фиксированный namespace — только для детерминизма


def _seed_int(seed: str) -> int:
    return int(hashlib.sha256(seed.encode()).hexdigest(), 16)


def _stable_uuid(username: str, tag: str) -> str:
    return str(_uuid.uuid5(_UUID_NS, f'{username}:{tag}'))


def _stable_android_device_id(username: str) -> str:
    return 'android-' + hashlib.sha256(f'{username}:android_device_id'.encode()).hexdigest()[:16]


def _stable_device_settings(username: str) -> dict:
    """Тот же профиль устройства для этого username при каждом вызове."""
    idx = _seed_int(f'{username}:device') % len(_DEVICE_POOL)
    device = dict(_DEVICE_POOL[idx])
    device["app_version"] = _DEFAULT_DEVICE["app_version"]
    device["version_code"] = _DEFAULT_DEVICE["version_code"]
    return device


def _stable_uuids_block(username: str) -> dict:
    return {
        "phone_id":          _stable_uuid(username, "phone_id"),
        "uuid":              _stable_uuid(username, "uuid"),
        "client_session_id": _rand_uuid(),   # id конкретной сессии — по делу меняется каждый вход
        "advertising_id":    _stable_uuid(username, "adid"),
        "android_device_id": _stable_android_device_id(username),
        "request_id":        _rand_uuid(),
        "tray_session_id":   _rand_uuid(),
    }


# Страна exit-IP прокси → локаль устройства. Несовпадение локали и гео IP — отдельный
# сигнал бота (см. autofacebook BAN-11: таймзона/локаль брались из гео прокси, а не
# захардкожены). Список — крупнейшие рынки; неизвестная страна → нейтральный en_US.
_COUNTRY_LOCALE = {
    'US': 'en_US', 'GB': 'en_GB', 'PL': 'pl_PL', 'DE': 'de_DE', 'FR': 'fr_FR',
    'ES': 'es_ES', 'IT': 'it_IT', 'UA': 'uk_UA', 'RU': 'ru_RU', 'NL': 'nl_NL',
    'PT': 'pt_PT', 'BR': 'pt_BR', 'MX': 'es_MX', 'CA': 'en_CA', 'AU': 'en_AU',
    'TR': 'tr_TR', 'IN': 'en_IN', 'ID': 'id_ID', 'CZ': 'cs_CZ', 'RO': 'ro_RO',
}


def _locale_for_proxy(proxy: str | None) -> tuple[str, str]:
    """Локаль/страна под гео exit-IP прокси. При сбое проверки — нейтральный en_US/US
    (не блокирует логин — это мягкое улучшение отпечатка, а не обязательное условие)."""
    if not proxy:
        return 'en_US', 'US'
    try:
        rep = check_proxy(proxy, use_cache=True)
        cc = (rep.get('country') or '').upper()
        if len(cc) == 2 and cc in _COUNTRY_LOCALE:
            return _COUNTRY_LOCALE[cc], cc
    except Exception as e:
        logger.warning("locale-by-proxy lookup failed: %s", e)
    return 'en_US', 'US'


def _apply_stable_fingerprint(cl: 'Client', username: str, proxy: str | None) -> None:
    """Проставить стабильное устройство/uuid/локаль ДО login()/восстановления сессии —
    ровно так же, как рекомендует сам instagrapi (settings ДО login, чтобы IG видел
    тот же 'телефон', а не новый при каждой попытке). Отказоустойчиво: при любой
    ошибке просто не трогаем cl — логин пойдёт со случайным устройством, как раньше."""
    try:
        locale, country = _locale_for_proxy(proxy)
        cl.set_settings({
            "uuids": _stable_uuids_block(username),
            "device_settings": _stable_device_settings(username),
            "locale": locale,
            "country": country,
        })
    except Exception as e:
        logger.warning("stable fingerprint setup failed for @%s (продолжаю со случайным устройством): %s", username, e)


def _rand_uuid() -> str:
    return str(_uuid.uuid4())


def _rand_android_id() -> str:
    return 'android-' + ''.join(random.choice('0123456789abcdef') for _ in range(16))


def _parse_user_agent(ua: str):
    """
    Разобрать мобильный Instagram User-Agent в ПОЛНЫЙ device_settings + locale.
    Формат instagrapi (config.USER_AGENT_BASE):
      Instagram <app_version> Android (<api>/<release>; <dpi>; <res>; <manufacturer>;
                <model>; <device>; <cpu>; <locale>; <version_code>)
    Пример: Instagram 359.2.0.64.89 Android (28/9; 544dpi; 800x1666; DOOGEE; S60; S60; mt6757; id_ID; 671551917)
    Возвращает (device_settings: dict, locale: str) либо None, если формат не распознан.
    """
    if not ua:
        return None
    m = re.search(r'Instagram\s+([\d.]+)\s+Android\s*\((.+)\)', ua)
    if not m:
        return None
    app_version = m.group(1).strip()
    fields = [x.strip() for x in m.group(2).split(';')]
    if len(fields) < 7:
        return None

    api_rel = fields[0].split('/')
    try:
        android_version = int(api_rel[0].strip())
    except (ValueError, IndexError):
        android_version = 28
    android_release = api_rel[1].strip() if len(api_rel) > 1 and api_rel[1].strip() else '9'
    locale = fields[7] if len(fields) > 7 and fields[7] else 'en_US'
    version_code = fields[8] if len(fields) > 8 else ''

    device_settings = {
        "app_version":     app_version,
        "android_version": android_version,
        "android_release": android_release,
        "dpi":             fields[1],
        "resolution":      fields[2],
        "manufacturer":    fields[3],
        "model":           fields[4],
        "device":          fields[5],
        "cpu":             fields[6],
        "version_code":    version_code,
    }
    return device_settings, locale


def _parse_mobile_session(raw: str) -> dict:
    """
    Разобрать pipe-формат экспорта мобильной Android-сессии Instagram:
      user:pass:2fa | UserAgent | android-<id>;uuid;phone_id;adid | Key=Val;Key=Val; | |
    Возвращает ПОЛНЫЙ instagrapi-совместимый settings-словарь: uuids + device_settings +
    user_agent + cookies + authorization_data + mid/rur/claim + locale/country.

    Ключевое: device_settings ВСЕГДА полный (с app_version и пр.), иначе instagrapi падает
    на `KeyError: 'app_version'` при построении base_headers в init(). Идентификаторы
    устройства (device_id/uuid/phone_id/adid) кладём в блок uuids — там их и ждёт instagrapi,
    а НЕ в device_settings.
    """
    parts = raw.split('|')

    user_agent = parts[1].strip() if len(parts) > 1 else ''

    # Идентификаторы устройства (часть 3): "android-XXXX;uuid;phone_id;adid"
    device_ids = [d.strip() for d in parts[2].split(';')] if len(parts) > 2 else []
    android_device_id = device_ids[0] if len(device_ids) > 0 and device_ids[0] else _rand_android_id()
    uuid_val = device_ids[1] if len(device_ids) > 1 and device_ids[1] else _rand_uuid()
    phone_id = device_ids[2] if len(device_ids) > 2 and device_ids[2] else _rand_uuid()
    adid     = device_ids[3] if len(device_ids) > 3 and device_ids[3] else _rand_uuid()

    # Заголовки (часть 4): "Key=Value;Key=Value;..."
    headers: dict[str, str] = {}
    if len(parts) > 3:
        for item in parts[3].split(';'):
            item = item.strip()
            if '=' in item:
                k, _, v = item.partition('=')
                headers[k.strip()] = v.strip()

    # Decode Bearer IGT:2:<base64> → {"ds_user_id": "...", "sessionid": "..."}
    auth       = headers.get('Authorization', '')
    session_id = ''
    ds_user_id = headers.get('IG-U-DS-USER-ID', '') or headers.get('IG-INTENDED-USER-ID', '')

    if 'IGT:2:' in auth:
        b64 = auth.split('IGT:2:', 1)[1].strip()
        b64 += '=' * ((4 - len(b64) % 4) % 4)
        try:
            decoded = json.loads(base64.b64decode(b64).decode('utf-8'))
            # sessionid держим В ТОМ ЖЕ виде, что и в токене (обычно с %3A) — чтобы
            # реконструированный instagrapi Bearer совпадал с исходным байт-в-байт.
            session_id = decoded.get('sessionid', '') or session_id
            if not ds_user_id:
                ds_user_id = str(decoded.get('ds_user_id', ''))
        except Exception as e:
            logger.warning("Bearer decode failed: %s", e)

    # Запасные пути на случай необычного экспорта
    if not session_id:
        session_id = headers.get('sessionid', '')
    if not ds_user_id and session_id:
        num = re.match(r'^(\d+)', session_id)
        if num:
            ds_user_id = num.group(1)

    # device_settings из User-Agent; если UA не распознан — дефолтное устройство
    parsed = _parse_user_agent(user_agent)
    if parsed:
        device_settings, locale = parsed
    else:
        logger.warning("User-Agent не распознан, беру дефолтное устройство: %.60s", user_agent)
        device_settings, locale = dict(_DEFAULT_DEVICE), 'en_US'

    country = locale.split('_')[-1].upper() if '_' in locale else 'US'

    mid   = headers.get('X-MID', '')
    rur   = headers.get('IG-U-RUR', '')
    claim = headers.get('X-IG-WWW-Claim', '')
    csrf  = headers.get('csrftoken', '') or headers.get('X-CSRFToken', '')

    cookies: dict[str, str] = {}
    if session_id:
        cookies["sessionid"] = session_id
    if ds_user_id:
        cookies["ds_user_id"] = ds_user_id
    if csrf:
        cookies["csrftoken"] = csrf
    if mid:
        cookies["mid"] = mid

    logger.info("Mobile session parsed: user_id=%s app_version=%s session=%s…",
                ds_user_id, device_settings.get("app_version"), session_id[:16])

    return {
        "uuids": {
            "phone_id":          phone_id,
            "uuid":              uuid_val,
            "client_session_id": _rand_uuid(),
            "advertising_id":    adid,
            "android_device_id": android_device_id,
            "request_id":        _rand_uuid(),
            "tray_session_id":   _rand_uuid(),
        },
        "cookies": cookies,
        "device_settings": device_settings,
        "user_agent": user_agent,
        "authorization_data": {
            "ds_user_id": ds_user_id,
            "sessionid":  session_id,
            # instagrapi аутентифицируется Bearer-заголовком (он у нас валидный из токена),
            # а не только кукой — так же, как делает штатный login_by_sessionid.
            "should_use_header_over_cookies": True,
        },
        "locale": locale,
        "country": country,
        "mid": mid,
        "ig_u_rur": rur,
        "ig_www_claim": claim,
    }


def _is_mobile_session(cookies: dict) -> bool:
    """Detect pipe-delimited Android session pasted as {"sessionid": "<raw>"}."""
    raw = cookies.get('sessionid', '')
    return isinstance(raw, str) and '|' in raw and 'Authorization=Bearer' in raw


def build_client(session_data: dict, proxy: str | None = None) -> Client:
    """Build a Client from saved session data. Does NOT call get_timeline_feed —
    that's only done during login/session-test to avoid suspicious bursts of
    identical requests before each action."""
    cl = Client()
    # Встроенная пауза instagrapi между запросами — дополнительная защита от бана
    cl.delay_range = [2, 6]
    if proxy:
        cl.set_proxy(_resolve_proxy_scheme(proxy))
    cl.set_settings(session_data)
    return cl


def test_session_live(session_data: dict, proxy: str | None = None) -> bool:
    """Verify a session is still alive by loading the timeline feed."""
    cl = build_client(session_data, proxy)
    cl.get_timeline_feed()
    return True


def _try_solve_recaptcha(page_url: str = 'https://www.instagram.com/challenge/') -> str | None:
    """Try to solve Instagram reCAPTCHA via 2captcha. Returns the g-recaptcha-response token or None."""
    if not TWOCAPTCHA_KEY:
        return None
    try:
        from twocaptcha import TwoCaptcha
        solver = TwoCaptcha(TWOCAPTCHA_KEY)
        result = solver.recaptcha(sitekey=_IG_RECAPTCHA_SITEKEY, url=page_url)
        token = result.get('code', '')
        logger.info("2captcha solved reCAPTCHA, token=%s...", token[:20])
        return token
    except Exception as e:
        logger.warning("2captcha solve failed: %s", e)
        return None


def _totp_code(cl: Client, secret: str) -> str:
    """Сгенерировать 6-значный TOTP-код из 2FA-ключа (base32). Пробелы/дефисы игнорируем."""
    seed = secret.replace(' ', '').replace('-', '').strip()
    return cl.totp_generate_code(seed)


def login_by_credentials(username: str, password: str, proxy: str | None = None, totp_secret: str | None = None) -> dict:
    """
    Returns {'sessionData': dict} on success.
    Returns {'needsChallenge': True, 'stepName': str, 'username': str} when challenge is required
    (challenge session stored internally — call submit_challenge_code next).
    totp_secret — 2FA-ключ (base32) для аккаунтов с включённой двухфакторной аутентификацией.
    Raises Exception on hard failure.
    """
    cl = Client()
    if proxy:
        cl.set_proxy(_resolve_proxy_scheme(proxy))
    _apply_stable_fingerprint(cl, username, proxy)

    try:
        if totp_secret:
            # Аккаунт с 2FA: сразу передаём сгенерированный код
            cl.login(username, password, verification_code=_totp_code(cl, totp_secret))
        else:
            cl.login(username, password)
        return {'sessionData': cl.get_settings()}

    except TwoFactorRequired:
        # Instagram запросил 2FA. Если есть ключ — повторяем вход с кодом; иначе пробрасываем.
        if totp_secret:
            try:
                cl.login(username, password, verification_code=_totp_code(cl, totp_secret))
                return {'sessionData': cl.get_settings()}
            except Exception as e2:
                raise Exception(f"2FA код не принят — проверьте 2FA-ключ ({e2})")
        raise

    except ChallengeRequired:
        challenge = cl.last_json.get('challenge', {})
        api_path = challenge.get('api_path', '')

        if not api_path:
            raise Exception("Требуется подтверждение Instagram. Войдите вручную в приложение.")

        # Fetch challenge info
        try:
            resp = cl.private.get(f'https://i.instagram.com{api_path}?next=%2F')
            challenge_data = resp.json()
        except Exception as e:
            raise Exception(f"ChallengeRequired: не удалось получить тип challenge ({e})")

        step_name = challenge_data.get('step_name', '')
        logger.info("Challenge step=%s for @%s api_path=%s", step_name, username, api_path)

        # Try automatic resolution depending on step type
        if step_name == 'delta_login_review':
            # "Was this you?" — confirm "it was me"
            try:
                confirm = cl.private.post(
                    f'https://i.instagram.com{api_path}',
                    data={'choice': '0'}
                ).json()
                if confirm.get('action') == 'close' or confirm.get('status') == 'ok':
                    cl.get_timeline_feed()
                    logger.info("delta_login_review confirmed, login complete for @%s", username)
                    return {'sessionData': cl.get_settings()}
                step_name = confirm.get('step_name', step_name)
            except Exception as e:
                logger.warning("delta_login_review confirm failed: %s", e)

        if step_name in ('recaptcha', 'captcha'):
            # Try to solve with 2captcha
            token = _try_solve_recaptcha()
            if token:
                try:
                    solve_resp = cl.private.post(
                        f'https://i.instagram.com{api_path}',
                        data={'g-recaptcha-response': token}
                    ).json()
                    if solve_resp.get('action') == 'close' or solve_resp.get('status') == 'ok':
                        cl.get_timeline_feed()
                        return {'sessionData': cl.get_settings()}
                    step_name = solve_resp.get('step_name', step_name)
                    logger.info("After captcha solve, step=%s", step_name)
                except Exception as e:
                    logger.warning("Captcha submit failed: %s", e)

        if step_name == 'select_verify_method':
            # Trigger code send to email (choice=1)
            try:
                send_resp = cl.private.post(
                    f'https://i.instagram.com{api_path}',
                    data={'choice': '1'}
                ).json()
                step_name = send_resp.get('step_name', step_name)
                logger.info("Email code requested, next step=%s", step_name)
            except Exception as e:
                logger.warning("Could not request email code: %s", e)

        # Store challenge session so submit_challenge_code can continue
        _challenge_sessions[username] = {
            'settings': cl.get_settings(),
            'api_path': api_path,
            'proxy': proxy,
        }

        return {'needsChallenge': True, 'stepName': step_name, 'username': username}

    except Exception as e:
        # Прикрепляем сырой ответ Instagram к ошибке — «снимок» для диагностики в UI.
        # Ловит BadPassword, SentryBlock и т.п. (2FA и Challenge обработаны выше).
        try:
            e.ig_snapshot = cl.last_json
        except Exception:
            pass
        raise


def submit_challenge_code(username: str, code: str) -> dict:
    """Submit the verification code received by email/SMS. Returns {'sessionData': dict}."""
    pending = _challenge_sessions.get(username)
    if not pending:
        raise Exception("Нет активного challenge. Начните авторизацию заново.")

    cl = Client()
    if pending.get('proxy'):
        cl.set_proxy(_resolve_proxy_scheme(pending['proxy']))
    cl.set_settings(pending['settings'])

    api_path = pending['api_path']

    try:
        resp = cl.private.post(
            f'https://i.instagram.com{api_path}',
            data={'security_code': code}
        )
        resp_data = resp.json()
        logger.info("Challenge code submit response: %s", resp_data)

        status = resp_data.get('status', '')
        action = resp_data.get('action', '')

        if status == 'ok' or action == 'close':
            cl.get_timeline_feed()
            del _challenge_sessions[username]
            return {'sessionData': cl.get_settings()}

        msg = resp_data.get('message', str(resp_data))
        raise Exception(f"Неверный код подтверждения: {msg}")

    except Exception as e:
        raise Exception(f"Ошибка подтверждения: {e}")


def _verify_and_username(cl: Client) -> str:
    """Проверить сессию приватным account_info() (accounts/current_user/, без GraphQL)
    и вернуть username. При ошибке прикрепляем сырой ответ Instagram (cl.last_json) —
    это «настоящая причина»: login_required (сессия мертва), checkpoint/challenge_required
    (чекпоинт), feedback_required (ограничение), либо сетевой/прокси-сбой (last_json пуст)."""
    # Человеко-подобный прогрев ленты — не критично, если не удался.
    try:
        cl.get_timeline_feed()
    except Exception as e:
        logger.info("get_timeline_feed прогрев не удался (не критично): %s", e)
    try:
        info = cl.account_info()
        return info.username
    except Exception as e:
        try:
            e.ig_snapshot = cl.last_json
        except Exception:
            pass
        raise


def login_by_cookies(cookies: dict, proxy: str | None = None) -> tuple[dict, str]:
    """Вход по кукам/сессии. Поддерживает:
      • pipe-формат мобильной Android-сессии (парсится в полный settings);
      • обычный словарь куки (sessionid, csrftoken, …) или один sessionid.
    Проверка/username — через приватный account_info() (НЕ через login_by_sessionid/
    публичный GraphQL: его query_hash Instagram задеприкейтил → 400 «invalid request»)."""
    norm_proxy = _resolve_proxy_scheme(proxy)

    def _new_client() -> Client:
        c = Client()
        c.delay_range = [2, 6]
        if norm_proxy:
            c.set_proxy(norm_proxy)
        return c

    if _is_mobile_session(cookies):
        # Экспорт мобильной сессии — собираем полный settings и логинимся им
        settings = _parse_mobile_session(cookies['sessionid'])
        cl = _new_client()
        cl.set_settings(settings)
        return cl.get_settings(), _verify_and_username(cl)

    # Обычные (веб) куки: словарь sessionid/csrftoken/ds_user_id/… либо один sessionid.
    cl = _new_client()
    session_id = cookies.get('sessionid', '') if isinstance(cookies, dict) else ''
    if session_id:
        # Строим authorization_data из sessionid → instagrapi шлёт валидный Bearer-заголовок.
        # На «голые» куки приватный API нередко отвечает login_required, а с Bearer — ок
        # (так же поступает штатный login_by_sessionid).
        ds_uid = cookies.get('ds_user_id', '')
        if not ds_uid:
            m = re.match(r'^(\d+)', session_id)
            ds_uid = m.group(1) if m else ''
        settings = {
            "cookies": cookies,
            "authorization_data": {
                "ds_user_id": ds_uid,
                "sessionid": session_id,
                "should_use_header_over_cookies": True,
            },
        }
        # Стабильный отпечаток по ds_user_id (постоянный numeric ID аккаунта — надёжнее
        # username) — та же логика, что в login_by_credentials, см. комментарий там.
        try:
            seed_key = ds_uid or session_id[:24]
            locale, country = _locale_for_proxy(proxy)
            settings["uuids"] = _stable_uuids_block(seed_key)
            settings["device_settings"] = _stable_device_settings(seed_key)
            settings["locale"] = locale
            settings["country"] = country
        except Exception as e:
            logger.warning("stable fingerprint setup (cookies) failed (продолжаю без него): %s", e)
        cl.set_settings(settings)
    else:
        cl.private.cookies.update(cookies)
    return cl.get_settings(), _verify_and_username(cl)


def get_account_info(session_data: dict, proxy: str | None = None) -> dict:
    """Инфо о собственном аккаунте: реальное число подписчиков/подписок/постов."""
    cl = build_client(session_data, proxy)
    info = cl.account_info()
    return {
        "username": getattr(info, "username", ""),
        "follower_count": int(getattr(info, "follower_count", 0) or 0),
        "following_count": int(getattr(info, "following_count", 0) or 0),
        "media_count": int(getattr(info, "media_count", 0) or 0),
    }


def get_followers(session_data: dict, username: str, proxy: str | None = None, amount: int = 50) -> list[dict]:
    cl = build_client(session_data, proxy)
    user_id = cl.user_id_from_username(username)
    followers = cl.user_followers(user_id, amount=amount)
    result = [
        {"pk": str(u.pk), "username": u.username, "full_name": u.full_name}
        for u in followers.values()
    ]
    logger.info("get_followers: @%s → %d followers (amount=%d)", username, len(result), amount)
    return result


def get_following(session_data: dict, username: str, proxy: str | None = None, amount: int = 50) -> list[dict]:
    """Список тех, на кого подписан аккаунт (для проверки «взаимная подписка» черновым)."""
    cl = build_client(session_data, proxy)
    user_id = cl.user_id_from_username(username)
    following = cl.user_following(user_id, amount=amount)
    result = [{"pk": str(u.pk), "username": u.username} for u in following.values()]
    logger.info("get_following: @%s → %d following (amount=%d)", username, len(result), amount)
    return result


def send_direct_message(session_data: dict, to_user_id: str, text: str, proxy: str | None = None) -> dict:
    cl = build_client(session_data, proxy)
    thread = cl.direct_send(text, [int(to_user_id)])
    return {"thread_id": str(thread.id), "status": "sent"}


def follow_user(session_data: dict, user_id: str, proxy: str | None = None) -> dict:
    """Подписаться в ответ на пользователя по его pk."""
    cl = build_client(session_data, proxy)
    ok = cl.user_follow(int(user_id))
    return {"status": "followed" if ok else "noop"}


def like_latest_media(session_data: dict, user_id: str, proxy: str | None = None) -> dict:
    """Лайкнуть последний пост пользователя по его pk."""
    cl = build_client(session_data, proxy)
    medias = cl.user_medias(int(user_id), amount=1)
    if not medias:
        return {"status": "no_media"}
    cl.media_like(medias[0].id)
    return {"status": "liked", "media_id": str(medias[0].id)}


def like_user_medias(session_data: dict, user_id: str, amount: int = 3, proxy: str | None = None) -> dict:
    """Зайти на профиль пользователя и пролайкать его последние посты (если они есть)."""
    cl = build_client(session_data, proxy)
    medias = cl.user_medias(int(user_id), amount=amount)
    if not medias:
        return {"status": "no_media", "liked": 0}
    liked = 0
    for m in medias:
        try:
            cl.media_like(m.id)
            liked += 1
            time.sleep(random.uniform(2.0, 5.0))  # пауза между лайками
        except Exception as e:
            logger.warning("media_like failed for %s: %s", getattr(m, "id", "?"), e)
    return {"status": "liked", "liked": liked}


def send_direct_photo(session_data: dict, to_user_id: str, image_b64: str, proxy: str | None = None) -> dict:
    """Отправить фото в директ. image_b64 — data-URL или чистый base64."""
    import tempfile, os
    cl = build_client(session_data, proxy)
    raw = image_b64.split(',', 1)[1] if image_b64.startswith('data:') else image_b64
    data = base64.b64decode(raw)
    tmp = tempfile.NamedTemporaryFile(suffix='.jpg', delete=False)
    try:
        tmp.write(data)
        tmp.flush()
        tmp.close()
        thread = cl.direct_send_photo(tmp.name, [int(to_user_id)])
        return {"thread_id": str(thread.id), "status": "sent"}
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def get_recent_comments(session_data: dict, username: str, proxy: str | None = None,
                        media_count: int = 4, per_media: int = 20) -> list[dict]:
    """Собрать недавние комментарии под последними постами аккаунта.
    Возвращает [{pk, text, user_pk, username, media_id}], исключая собственные комментарии."""
    cl = build_client(session_data, proxy)
    own_id = str(cl.user_id)
    user_id = cl.user_id_from_username(username)
    main_id = str(user_id)  # фильтруем и ответы самого MAIN-аккаунта
    medias = cl.user_medias(user_id, amount=media_count)
    out: list[dict] = []
    for m in medias:
        try:
            comments = cl.media_comments(m.id, amount=per_media)
        except Exception as e:
            logger.warning("media_comments failed for %s: %s", m.id, e)
            continue
        for c in comments:
            uid = str(c.user.pk)
            if uid == own_id or uid == main_id:
                continue
            out.append({
                "pk": str(c.pk),
                "text": c.text or "",
                "user_pk": uid,
                "username": c.user.username,
                "media_id": str(m.id),
            })
    logger.info("get_recent_comments: @%s → %d comments", username, len(out))
    return out


def get_recent_likers(session_data: dict, username: str, proxy: str | None = None,
                      media_count: int = 3, per_media: int = 50) -> list[dict]:
    """Собрать пользователей, лайкнувших последние посты аккаунта.
    Возвращает [{pk, username, media_id}], исключая собственные лайки и дубли."""
    cl = build_client(session_data, proxy)
    own_id = str(cl.user_id)
    user_id = cl.user_id_from_username(username)
    medias = cl.user_medias(user_id, amount=media_count)
    out: list[dict] = []
    seen: set[str] = set()
    for m in medias:
        try:
            likers = cl.media_likers(m.id)
        except Exception as e:
            logger.warning("media_likers failed for %s: %s", m.id, e)
            continue
        for u in likers[:per_media]:
            uid = str(u.pk)
            if uid == own_id or uid in seen:
                continue
            seen.add(uid)
            out.append({"pk": uid, "username": u.username, "media_id": str(m.id)})
    logger.info("get_recent_likers: @%s → %d likers", username, len(out))
    return out


def get_story_events(session_data: dict, proxy: str | None = None, amount: int = 10) -> list[dict]:
    """Собрать входящие story-события из директа: ответы на наши сторис (reply) и
    упоминания нас в чужих сторис (mention). Возвращает [{pk, user_pk, username, text, kind}].
    Разбор дефенсивный — при неожиданной структуре пропускаем элемент."""
    cl = build_client(session_data, proxy)
    own_id = str(cl.user_id)
    out: list[dict] = []

    threads = []
    try:
        threads = list(cl.direct_threads(amount=amount))
    except Exception as e:
        logger.warning("direct_threads failed: %s", e)
    try:
        threads += list(cl.direct_pending_inbox(amount=amount))
    except Exception as e:
        logger.warning("direct_pending_inbox failed: %s", e)

    def _get(obj, key):
        if isinstance(obj, dict):
            return obj.get(key)
        return getattr(obj, key, None)

    for t in threads:
        users = _get(t, "users") or []
        uname_by_pk = {str(_get(u, "pk")): (_get(u, "username") or "") for u in users}
        for it in (_get(t, "messages") or []):
            try:
                itype = (_get(it, "item_type") or "")
                uid = str(_get(it, "user_id") or "")
                if not uid or uid == own_id:
                    continue
                kind = None
                text = ""
                if itype == "reel_share":
                    rs = _get(it, "reel_share")
                    rtype = (_get(rs, "type") or "") if rs is not None else ""
                    text = (_get(rs, "text") or "") if rs is not None else ""
                    kind = "mention" if rtype == "mention" else "reply"
                elif itype == "story_share":
                    kind = "mention"
                if not kind:
                    continue
                out.append({
                    "pk": str(_get(it, "id") or _get(it, "item_id") or ""),
                    "user_pk": uid,
                    "username": uname_by_pk.get(uid, ""),
                    "text": text,
                    "kind": kind,
                })
            except Exception as e:
                logger.warning("story event parse failed: %s", e)
    logger.info("get_story_events: %d events", len(out))
    return out


def reply_to_comment(session_data: dict, media_id: str, text: str,
                     comment_id: str | None = None, proxy: str | None = None) -> dict:
    """Ответить комментарием под постом (опционально — реплаем на конкретный комментарий)."""
    cl = build_client(session_data, proxy)
    kwargs: dict = {}
    if comment_id:
        kwargs["replied_to_comment_pk"] = int(comment_id)
    c = cl.media_comment(media_id, text, **kwargs)
    return {"comment_id": str(getattr(c, "pk", "")), "status": "sent"}


def like_comment(session_data: dict, comment_id: str, proxy: str | None = None) -> dict:
    """Лайкнуть комментарий по его pk."""
    cl = build_client(session_data, proxy)
    ok = cl.comment_like(int(comment_id))
    return {"status": "liked" if ok else "noop"}


def get_friendship(session_data: dict, user_id: str, proxy: str | None = None) -> dict:
    """Статус отношений: following — мы подписаны на него; followed_by — он подписан на нас."""
    cl = build_client(session_data, proxy)
    fs = None
    try:
        fs = cl.user_friendship_v1(int(user_id))
    except Exception as e:
        logger.warning("user_friendship_v1 failed, trying friendship_show: %s", e)
        fs = cl.friendship_show(int(user_id))
    return {
        "following": bool(getattr(fs, "following", False)),
        "followed_by": bool(getattr(fs, "followed_by", False)),
    }


def view_stories(session_data: dict, user_id: str, like: bool = False, proxy: str | None = None) -> dict:
    """Просмотреть (отметить как увиденные) сторис пользователя, опционально пролайкать."""
    cl = build_client(session_data, proxy)
    stories = cl.user_stories(int(user_id))
    if not stories:
        return {"status": "no_stories", "viewed": 0, "liked": 0}

    viewed = 0
    try:
        pks = [int(s.pk) for s in stories]
        cl.story_seen(pks)
        viewed = len(pks)
    except Exception as e:
        logger.warning("story_seen failed: %s", e)

    liked = 0
    if like:
        for s in stories:
            try:
                cl.story_like(s.id)
                liked += 1
                time.sleep(random.uniform(1.5, 4.0))
            except Exception as e:
                logger.warning("story_like failed for %s: %s", getattr(s, "id", "?"), e)

    return {"status": "ok", "viewed": viewed, "liked": liked}


def view_stories_natural(session_data: dict, user_id: str, like: bool = False, proxy: str | None = None) -> dict:
    """Просмотр сторис по одной с паузами — как реальный пользователь."""
    cl = build_client(session_data, proxy)
    stories = cl.user_stories(int(user_id))
    if not stories:
        return {"status": "no_stories", "viewed": 0, "liked": 0}

    viewed = 0
    liked = 0
    for s in stories:
        try:
            cl.story_seen([int(s.pk)])  # по одной
            viewed += 1
            time.sleep(random.uniform(2.0, 5.0))  # пауза как при реальном просмотре
            if like:
                try:
                    cl.story_like(s.id)
                    liked += 1
                    time.sleep(random.uniform(1.0, 2.5))
                except Exception as e:
                    logger.warning("story_like failed: %s", e)
        except Exception as e:
            logger.warning("story_seen failed for %s: %s", getattr(s, "pk", "?"), e)

    return {"status": "ok", "viewed": viewed, "liked": liked}
