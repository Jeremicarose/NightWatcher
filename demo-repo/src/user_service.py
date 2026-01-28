"""User service module with an intentional bug for testing Nightwatch."""


def get_user(user_id: int) -> dict | None:
    """Get a user by ID. Returns None if not found."""
    users = {
        1: {"id": 1, "name": "Alice", "email": "alice@example.com"},
        2: {"id": 2, "name": "Bob", "email": "bob@example.com"},
    }
    return users.get(user_id)


def send_notification(user: dict, message: str) -> bool:
    """
    Send a notification to a user.

    BUG: No null check - will raise TypeError if user is None
    """
    email = user["email"]  # BUG: This fails if user is None
    print(f"Sending '{message}' to {email}")
    return True


def notify_user(user_id: int, message: str) -> bool:
    """Notify a user by their ID."""
    user = get_user(user_id)
    return send_notification(user, message)
