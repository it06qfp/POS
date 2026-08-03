"""
อัปโหลดรูปรายงานขึ้น Google Drive เป็นโฟลเดอร์รายวัน (ฝั่ง GitHub Actions)

โครงสร้างที่ตกลงกับฝั่ง Apps Script (lark-drive-thread.gs) — ต้องตรงกันทั้งสองฝั่ง:
    <โฟลเดอร์แม่>/<yyyy-MM-dd ตามเวลาไทย>/<ชื่อไฟล์>
Apps Script เรียงรูปตามชื่อไฟล์ จึงตั้งชื่อ 1_..4_ ให้รูปรายวัน และ 5_weekly_... ให้รูปสัปดาห์

ตัวแปรแวดล้อมที่ใช้ (ถ้าไม่ครบ = ข้ามการอัปโหลดเงียบ ๆ ไม่ทำให้ job พัง):
    GDRIVE_SERVICE_ACCOUNT_JSON   JSON key ของ service account (ทั้งก้อน)
    GDRIVE_PARENT_FOLDER_ID       id ของโฟลเดอร์แม่ "Lark - POS - Report"

ข้อควรระวังเรื่องสิทธิ์ (เจอมาแล้วในทีม):
  - service account ไม่มี storage quota ของตัวเอง → อัปไฟล์เข้าโฟลเดอร์ใน My Drive ของคนอื่น
    จะโดน storageQuotaExceeded ทางที่ใช้ได้จริงคือให้โฟลเดอร์แม่อยู่ใน **Shared Drive**
    แล้วเพิ่ม service account เป็นสมาชิก (Content manager) — โค้ดนี้ส่ง supportsAllDrives แล้ว
  - ถ้ายังต้องใช้ My Drive จริง ๆ ให้เปลี่ยนไปใช้ OAuth refresh token ของผู้ใช้จริงแทน SA
"""
from __future__ import annotations

import io
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

BKK = timezone(timedelta(hours=7))
SCOPES = ["https://www.googleapis.com/auth/drive"]


def daily_folder_name(now: Optional[datetime] = None) -> str:
    """ชื่อโฟลเดอร์รายวัน — ต้องตรงกับ dailyFolderName_() ใน lark-drive-thread.gs"""
    return (now or datetime.now(BKK)).astimezone(BKK).strftime("%Y-%m-%d")


def _service():
    """คืน Drive service หรือ None ถ้า config ไม่ครบ (ให้ผู้เรียกข้ามการอัปโหลดได้)"""
    raw = os.environ.get("GDRIVE_SERVICE_ACCOUNT_JSON")
    parent = os.environ.get("GDRIVE_PARENT_FOLDER_ID")
    if not raw or not parent:
        return None, None
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except ImportError as exc:
        print(f"[drive] ไม่มี google-api-python-client ({exc}) -> ข้ามการอัปโหลด Drive")
        return None, None
    info = json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False), parent


def _get_or_create_daily_folder(svc, parent_id: str, name: str) -> str:
    """
    หา/สร้างโฟลเดอร์รายวัน เลือกอันที่สร้างก่อนสุดถ้ามีชื่อซ้ำ
    (Apps Script ก็เลือกอันเก่าสุดเหมือนกัน → ทั้งสองฝั่งลงเอยโฟลเดอร์เดียวกันแม้สร้างชนกัน)
    """
    safe = name.replace("'", "\\'")
    q = (
        f"name = '{safe}' and mimeType = 'application/vnd.google-apps.folder' "
        f"and '{parent_id}' in parents and trashed = false"
    )
    res = svc.files().list(
        q=q, fields="files(id,name,createdTime)", orderBy="createdTime",
        pageSize=10, supportsAllDrives=True, includeItemsFromAllDrives=True,
    ).execute()
    files = res.get("files", [])
    if files:
        return files[0]["id"]
    created = svc.files().create(
        body={"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent_id]},
        fields="id", supportsAllDrives=True,
    ).execute()
    print(f"[drive] สร้างโฟลเดอร์รายวัน {name}")
    return created["id"]


def upload_images(images, now: Optional[datetime] = None) -> list:
    """
    อัปโหลดรูปเข้าโฟลเดอร์รายวัน
      images: list ของ (file_name, png_bytes)
    คืน list ของ file id ที่อัปสำเร็จ; ถ้า config ไม่ครบคืน [] และไม่ raise
    ไฟล์ชื่อเดิมในโฟลเดอร์จะถูกทับ (ลบตัวเก่าก่อน) เพื่อให้รันซ้ำวันเดียวกันไม่ได้รูปซ้ำ

    scale: 1 รูป = 1-3 API call (list ชื่อซ้ำ + delete ถ้ามี + upload) — 4 รูป ~2-3 วิ
    ไม่มี loop ซ้อน ไม่ต้องกลัวชนเพดานเวลาของ Actions
    """
    svc, parent = _service()
    if svc is None:
        print("[drive] ไม่ได้ตั้ง GDRIVE_SERVICE_ACCOUNT_JSON / GDRIVE_PARENT_FOLDER_ID -> ข้ามการอัปโหลด")
        return []

    from googleapiclient.http import MediaIoBaseUpload

    day = daily_folder_name(now)
    folder_id = _get_or_create_daily_folder(svc, parent, day)
    uploaded = []

    for file_name, data in images:
        safe = file_name.replace("'", "\\'")
        dupes = svc.files().list(
            q=f"name = '{safe}' and '{folder_id}' in parents and trashed = false",
            fields="files(id)", pageSize=10,
            supportsAllDrives=True, includeItemsFromAllDrives=True,
        ).execute().get("files", [])
        for d in dupes:
            svc.files().delete(fileId=d["id"], supportsAllDrives=True).execute()

        media = MediaIoBaseUpload(io.BytesIO(data), mimetype="image/png", resumable=False)
        created = svc.files().create(
            body={"name": file_name, "parents": [folder_id]},
            media_body=media, fields="id,name,size", supportsAllDrives=True,
        ).execute()
        uploaded.append(created["id"])
        size_kb = int(created.get("size", len(data))) // 1024
        print(f"[drive] อัปโหลด {day}/{file_name} ({size_kb} KB)")

    return uploaded


if __name__ == "__main__":
    # smoke test: สร้างรูปเปล่า 1 ใบแล้วอัปขึ้นโฟลเดอร์ของวันนี้
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (400, 200), "#1d4ed8").save(buf, format="PNG")
    ids = upload_images([(f"0_smoke_{daily_folder_name()}.png", buf.getvalue())])
    print("uploaded ids:", ids or "(ข้าม — config ไม่ครบ)")
