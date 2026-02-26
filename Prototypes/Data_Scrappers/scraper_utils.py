#!/usr/bin/env python3
"""Shared utilities for universal_scraper and viewport_grid."""

from datetime import datetime


def log_debug(message: str, level: str = "INFO") -> None:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    prefix = {
        "INFO": "ℹ️ ",
        "SUCCESS": "✅",
        "ERROR": "❌",
        "WARN": "⚠️ ",
        "DEBUG": "🔍"
    }.get(level, "  ")
    print(f"[{timestamp}] {prefix} {message}", flush=True)
