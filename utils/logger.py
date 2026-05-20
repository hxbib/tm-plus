from __future__ import annotations
import logging
import os
import sys
import threading
from datetime import datetime
from logging.handlers import RotatingFileHandler
from typing import Optional

class Colors:
    RESET     = "\033[0m"
    BOLD      = "\033[1m"
    DIM       = "\033[2m"

    RED       = "\033[91m"
    GREEN     = "\033[92m"
    YELLOW    = "\033[93m"
    BLUE      = "\033[94m"
    MAGENTA   = "\033[95m"
    CYAN      = "\033[96m"
    WHITE     = "\033[97m"
    GRAY      = "\033[90m"

    BG_RED    = "\033[41m"
    BG_GREEN  = "\033[42m"
    BG_YELLOW = "\033[43m"
    BG_BLUE   = "\033[44m"

    TM_BLUE   = "\033[38;5;33m"
    TM_CYAN   = "\033[38;5;45m"
    TM_GOLD   = "\033[38;5;220m"
    TM_ORANGE = "\033[38;5;208m"

LEVEL_STYLES = {
    "DEBUG":    (Colors.GRAY,      "DBG"),
    "INFO":     (Colors.CYAN,      "INFO"),
    "SUCCESS":  (Colors.GREEN,     "OK"),
    "WARNING":  (Colors.TM_ORANGE, "WARN"),
    "ERROR":    (Colors.RED,       "ERR"),
    "CRITICAL": (Colors.BG_RED + Colors.WHITE, "CRT"),
}

SUCCESS_LEVEL = 25
logging.addLevelName(SUCCESS_LEVEL, "SUCCESS")

def success(self, message, *args, **kwargs):
    if self.isEnabledFor(SUCCESS_LEVEL):
        self._log(SUCCESS_LEVEL, message, args, **kwargs)

logging.Logger.success = success

def _ensure_utf8_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

def _resolve_continue_char() -> str:
    for ch in ("\u2514", "\u21b3", "+"):
        try:
            ch.encode(sys.stdout.encoding or "utf-8")
            return ch
        except (LookupError, UnicodeEncodeError):
            continue
    return "+"

class ColoredFormatter(logging.Formatter):

    TIME_WIDTH = 12
    LEVEL_WIDTH = 4
    MODULE_WIDTH = 16

    _last_module: str | None = None
    _lock = threading.Lock()

    def __init__(self, use_colors: bool = True):
        super().__init__()
        self.use_colors = use_colors
        self._continue_char = _resolve_continue_char()

    @classmethod
    def reset_module_group(cls) -> None:
        with cls._lock:
            cls._last_module = None

    @staticmethod
    def _timestamp(record: logging.LogRecord) -> str:
        dt = datetime.fromtimestamp(record.created)
        return f"{dt.strftime('%H:%M:%S')}.{int(record.msecs):03d}"

    def _module_cell(self, module: str) -> tuple[str, bool]:
        with self._lock:
            if module == ColoredFormatter._last_module:
                display = self._continue_char
                continued = True
            else:
                display = module
                ColoredFormatter._last_module = module
                continued = False
        return display[: self.MODULE_WIDTH].ljust(self.MODULE_WIDTH), continued

    def format(self, record: logging.LogRecord) -> str:
        timestamp = self._timestamp(record)
        level_name = record.levelname
        color, tag = LEVEL_STYLES.get(level_name, (Colors.WHITE, "???"))
        tag = tag[: self.LEVEL_WIDTH].ljust(self.LEVEL_WIDTH)
        module = getattr(record, "module_name", record.name)
        mod_cell, continued = self._module_cell(module)
        message = record.getMessage()

        if not self.use_colors:
            return (
                f"{timestamp.ljust(self.TIME_WIDTH)}  {tag}  {mod_cell}  {message}"
            )

        mod_color = f"{Colors.DIM}{Colors.GRAY}" if continued else Colors.WHITE
        msg_color = color if level_name in ("ERROR", "CRITICAL", "WARNING") else Colors.WHITE
        return (
            f"{Colors.GRAY}{timestamp.ljust(self.TIME_WIDTH)}{Colors.RESET}"
            f"  {color}{Colors.BOLD}{tag}{Colors.RESET}"
            f"  {mod_color}{mod_cell}{Colors.RESET}"
            f"  {msg_color}{message}{Colors.RESET}"
        )

class FileFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        level_name = record.levelname.ljust(8)
        module = getattr(record, "module_name", record.name)
        return f"[{timestamp}] [{level_name}] [{module}] {record.getMessage()}"

_loggers: dict[str, logging.Logger] = {}
_initialized = False
_root_logger: Optional[logging.Logger] = None

def init_logging(config: dict) -> None:
    global _initialized, _root_logger

    if _initialized:
        return

    log_cfg = config.get("logging", {})
    level_str = log_cfg.get("level", "INFO").upper()
    level = getattr(logging, level_str, logging.INFO)
    use_colors = log_cfg.get("console_colors", True)
    file_logging = log_cfg.get("file_logging", True)
    max_bytes = log_cfg.get("log_rotation_max_bytes", 10 * 1024 * 1024)
    backup_count = log_cfg.get("log_rotation_backup_count", 5)

    _ensure_utf8_stdout()
    ColoredFormatter.reset_module_group()

    _root_logger = logging.getLogger("ticketmaster_plus")
    _root_logger.setLevel(level)
    _root_logger.handlers.clear()

    console = logging.StreamHandler(sys.stdout)
    console.setLevel(level)
    console.setFormatter(ColoredFormatter(use_colors=use_colors))
    _root_logger.addHandler(console)

    if file_logging:
        log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
        os.makedirs(log_dir, exist_ok=True)
        log_path = os.path.join(log_dir, "ticketmaster_plus.log")

        file_handler = RotatingFileHandler(
            log_path,
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding="utf-8",
        )
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(FileFormatter())
        _root_logger.addHandler(file_handler)

    _initialized = True

def get_logger(module_name: str) -> logging.Logger:
    if module_name in _loggers:
        return _loggers[module_name]

    logger = logging.getLogger(f"ticketmaster_plus.{module_name}")

    class _Filter(logging.Filter):
        def filter(self, record):
            record.module_name = module_name
            return True

    logger.addFilter(_Filter())
    _loggers[module_name] = logger
    return logger
