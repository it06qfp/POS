"""
ตรวจว่า service account เขียนโฟลเดอร์ Shared Drive ได้จริงก่อนเปิดใช้ pipeline
รันในเครื่อง (ตั้ง env 2 ตัว) หรือรันเป็น step ใน Actions ก็ได้:

    $env:GDRIVE_SERVICE_ACCOUNT_JSON = Get-Content sa.json -Raw
    $env:GDRIVE_PARENT_FOLDER_ID = "<id โฟลเดอร์ใน Shared Drive>"
    python scripts/drive_check.py

เช็ค 5 อย่าง: auth ได้ / เห็นโฟลเดอร์แม่ / โฟลเดอร์อยู่ใน Shared Drive จริง /
สร้างโฟลเดอร์รายวันได้ / อัปไฟล์ทดสอบได้แล้วลบออก (ไม่ทิ้งขยะไว้)
"""
from __future__ import annotations

import io
import json
import os
import sys

from drive_upload import SCOPES, daily_folder_name, _get_or_create_daily_folder


def fail(msg: str) -> None:
    print("FAIL  " + msg)
    sys.exit(1)


def main() -> None:
    raw = os.environ.get("GDRIVE_SERVICE_ACCOUNT_JSON")
    parent_id = os.environ.get("GDRIVE_PARENT_FOLDER_ID")
    if not raw or not parent_id:
        fail("ยังไม่ได้ตั้ง GDRIVE_SERVICE_ACCOUNT_JSON / GDRIVE_PARENT_FOLDER_ID")

    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaIoBaseUpload

    info = json.loads(raw)
    print("service account: " + info.get("client_email", "?"))
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    svc = build("drive", "v3", credentials=creds, cache_discovery=False)
    print("PASS  auth service account")

    try:
        folder = svc.files().get(
            fileId=parent_id, supportsAllDrives=True,
            fields="id,name,driveId,mimeType,capabilities(canAddChildren)",
        ).execute()
    except HttpError as exc:
        fail(f"service account เห็นโฟลเดอร์แม่ไม่ได้ ({exc.status_code}) "
             f"-> ยังไม่ได้เพิ่ม SA เป็นสมาชิก Shared Drive หรือ id ผิด")
    print(f"PASS  เห็นโฟลเดอร์แม่: {folder['name']}")

    if not folder.get("driveId"):
        fail("โฟลเดอร์นี้ไม่ได้อยู่ใน Shared Drive (ไม่มี driveId) — SA จะอัปไฟล์ไม่ได้ "
             "เพราะไม่มี storage quota ของตัวเอง ให้ย้าย/สร้างโฟลเดอร์ใน Shared Drive ก่อน")
    print(f"PASS  อยู่ใน Shared Drive จริง (driveId={folder['driveId']})")

    if not folder.get("capabilities", {}).get("canAddChildren"):
        fail("SA ไม่มีสิทธิ์สร้างไฟล์ในโฟลเดอร์นี้ — ต้องเป็น Content manager ขึ้นไป")
    print("PASS  SA มีสิทธิ์เขียน (canAddChildren)")

    day = daily_folder_name()
    folder_id = _get_or_create_daily_folder(svc, parent_id, day)
    print(f"PASS  โฟลเดอร์รายวันพร้อม: {day} ({folder_id})")

    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (320, 120), "#0f172a").save(buf, format="PNG")
    created = svc.files().create(
        body={"name": f"_drive_check_{day}.png", "parents": [folder_id]},
        media_body=MediaIoBaseUpload(buf, mimetype="image/png", resumable=False),
        fields="id,name", supportsAllDrives=True,
    ).execute()
    print(f"PASS  อัปไฟล์ทดสอบได้: {created['name']}")
    svc.files().delete(fileId=created["id"], supportsAllDrives=True).execute()
    print("PASS  ลบไฟล์ทดสอบออกแล้ว (ไม่ทิ้งขยะไว้)")

    print("\nพร้อมใช้งาน — ใส่ค่าเดียวกันนี้เป็น GitHub secrets ได้เลย")


if __name__ == "__main__":
    main()
