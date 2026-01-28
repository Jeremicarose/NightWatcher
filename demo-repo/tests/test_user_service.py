"""Tests for user_service module."""

import sys
import os

# Add src to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from user_service import get_user, send_notification, notify_user


def test_get_user_exists():
    """Test getting an existing user."""
    user = get_user(1)
    assert user is not None
    assert user["name"] == "Alice"
    assert user["email"] == "alice@example.com"


def test_get_user_not_exists():
    """Test getting a non-existent user."""
    user = get_user(999)
    assert user is None


def test_send_notification_valid_user():
    """Test sending notification to a valid user."""
    user = {"id": 1, "name": "Test", "email": "test@example.com"}
    result = send_notification(user, "Hello!")
    assert result is True


def test_send_notification_none_user():
    """
    Test sending notification when user is None.

    This test exposes the bug in send_notification() -
    it should handle None gracefully but instead raises TypeError.
    """
    # This will fail because send_notification doesn't handle None
    result = send_notification(None, "Hello!")
    assert result is False


def test_notify_user_exists():
    """Test notifying an existing user."""
    result = notify_user(1, "Welcome!")
    assert result is True


def test_notify_user_not_exists():
    """
    Test notifying a non-existent user.

    This test exposes the bug - notify_user calls send_notification
    with None when the user doesn't exist.
    """
    # This will fail due to the bug
    result = notify_user(999, "Hello?")
    assert result is False
