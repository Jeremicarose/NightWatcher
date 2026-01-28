"""Tests for user_service module."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from user_service import get_user, send_notification, notify_user


def test_get_user_exists():
    """Test getting an existing user."""
    user = get_user(1)
    assert user is not None
    assert user["name"] == "Alice"


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
    """This test exposes the bug - send_notification doesn't handle None."""
    result = send_notification(None, "Hello!")
    assert result is False


def test_notify_user_not_exists():
    """This test exposes the bug - notify_user fails for non-existent users."""
    result = notify_user(999, "Hello?")
    assert result is False
