from urllib.parse import urlsplit


def parsed_http_url(value):
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        return None
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        return None
    effective_port = port if port is not None else (80 if parsed.scheme == "http" else 443)
    return parsed, (parsed.scheme, parsed.hostname.lower(), effective_port)


def is_absolute_http_url(value):
    return parsed_http_url(value) is not None


def has_url_credentials(value):
    if not isinstance(value, str):
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    return parsed.username is not None or parsed.password is not None


def is_same_origin(first, second):
    first_parsed = parsed_http_url(first)
    second_parsed = parsed_http_url(second)
    return (
        first_parsed is not None
        and second_parsed is not None
        and first_parsed[1] == second_parsed[1]
    )
