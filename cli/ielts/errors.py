"""共用例外類別。"""


class IeltsError(Exception):
    """所有可預期的應用層錯誤的基底類別（CLI 會轉成友善訊息，不印 traceback）。"""


class QuitSession(IeltsError):
    """使用者在練習途中要求離開（按 q / Ctrl-C / EOF）。"""


class SkipItem(IeltsError):
    """使用者要求跳過目前這一題。"""


class ImportError_(IeltsError):
    """CSV 匯入失敗。"""
