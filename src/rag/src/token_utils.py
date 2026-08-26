import secrets
import string


def generate_strong_token(length: int = 40) -> str:
    """
    Generate a cryptographically strong random token.
    Default length is 40 characters (can be adjusted).
    """
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_unique_id(length: int = 12) -> str:
    """
    Generate a unique ID.
    Default length is 12 characters (can be adjusted).
    """
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))
