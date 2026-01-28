"""User service module with an intentional bug for testing Nightwatch."""


def get_user(user_id: int) -> dict | None:
    """Get a user by ID. Returns None if not found."""
    # Simulated database
    users = {
        1: {"id": 1, "name": "Alice", "email": "alice@example.com"},
        2: {"id": 2, "name": "Bob", "email": "bob@example.com"},
    }
    return users.get(user_id)


def send_notification(user: dict, message: str) -> bool:
    """
    Send a notification to a user.

    BUG: This function assumes user is never None, but get_user()
    can return None for non-existent users.
    """
    # BUG: No null check - will raise AttributeError if user is None
    email = user["email"]  # This line will fail if user is None

    # Simulate sending notification
    print(f"Sending '{message}' to {email}")
    return True


def notify_user(user_id: int, message: str) -> bool:
    """Notify a user by their ID."""
    user = get_user(user_id)
    return send_notification(user, message)
