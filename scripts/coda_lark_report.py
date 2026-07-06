#!/usr/bin/env python3
"""
POS Daily Lark report.

Pulls rows from a Coda table (filtered to rows where "รอคุยในที่ประชุม" is
blank), renders a grouped table image (merged group cells, wrapped product
names), and posts the image to a Lark group via incoming webhook.

Required environment variables (set as GitHub Actions secrets):
  CODA_API_TOKEN     Coda API token (coda.io -> Account Settings -> API Settings)
  LARK_APP_ID        Lark custom app id
  LARK_APP_SECRET    Lark custom app secret
  LARK_WEBHOOK_URL   Full Lark incoming-webhook URL

Optional:
  CODA_DOC_ID        default "MiXbfRif1m"
  CODA_TABLE_ID      default "table-OA56XddNFI"
"""
import json
import os
import sys
import time
from datetime import datetime

import requests
from PIL import Image, ImageDraw, ImageFont

CODA_API_TOKEN = os.environ["CODA_API_TOKEN"]
LARK_APP_ID = os.environ["LARK_APP_ID"]
LARK_APP_SECRET = os.environ["LARK_APP_SECRET"]
LARK_WEBHOOK_URL = os.environ["LARK_WEBHOOK_URL"]

DOC_ID = os.environ.get("CODA_DOC_ID", "MiXbfRif1m")
TABLE_ID = os.environ.get("CODA_TABLE_ID", "table-OA56XddNFI")

FILTER_COL = "c-i7ekT7SOM_"  # รอคุยในที่ประชุม -- must be blank to include the row
GROUP_COL = "c-jF5iOvd80f"  # รายการแจ้งเปลี่ยนแปลง -- merged group column

COLUMNS = [
    ("c-zk747feqUX", "Account"),
    ("c-lCcIWuw_5l", "DO"),
    ("c-zcDPi1nMsT", "OrderQty"),
    ("c-PVu77YUoUi", "ShipQty"),
    ("c-UYhihPAYaK", "Unit"),
    ("c-LKixuyNFtD", "PDPU"),
    ("c-662Yf7ofUD", "MOPR"),
    ("c-hCqU5uBXTm", "ProdCode"),
    ("c-8U2jOYy6u7", "ProdName"),
    ("c-48hXm7Nnyl", "CRD0"),
    ("c-P37xdvCRsg", "CRDEdit"),
    ("c-5JlVWZo0Xg", "LoadConfirm"),
    ("c-84r68317OU", "ArriveDate"),
    ("c-HvRU96fdFo", "Status"),
]
DATE_KEYS = {"CRD0", "CRDEdit", "LoadConfirm", "ArriveDate"}
NUM_KEYS = {"OrderQty", "ShipQty"}

HEADERS_TH = {
    "Account": "Account Name",
    "DO": "DO-shipment",
    "OrderQty": "จำนวนเปิด Order",
    "ShipQty": "Shipment-Qty",
    "Unit": "Unit",
    "PDPU": "PD/PU",
    "MOPR": "MO/PR",
    "ProdCode": "Product Code",
    "ProdName": "Product Name",
    "CRD0": "CRDตั้งต้น",
    "CRDEdit": "CRD Sales Edit",
    "LoadConfirm": "Load Confirm",
    "ArriveDate": "วันที่ถึงลูกค้า",
    "Status": "Status_DO-Shipment",
}
COL_WIDTHS = {
    "Account": 240, "DO": 130, "OrderQty": 95, "ShipQty": 105, "Unit": 50,
    "PDPU": 65, "MOPR": 110, "ProdCode": 110, "ProdName": 380, "CRD0": 95,
    "CRDEdit": 100, "LoadConfirm": 95, "ArriveDate": 100, "Status": 160,
}
GROUP_WIDTH = 200

FONT_REGULAR_CANDIDATES = [
    "/usr/share/fonts/truetype/tlwg/Waree.ttf",
    "/usr/share/fonts/truetype/tlwg/Garuda.ttf",
]
FONT_BOLD_CANDIDATES = [
    "/usr/share/fonts/truetype/tlwg/Waree-Bold.ttf",
    "/usr/share/fonts/truetype/tlwg/Garuda-Bold.ttf",
]


def extract_value(cell):
    if cell is None:
        return ""
    if isinstance(cell, dict):
        return cell.get("name") or cell.get("value") or ""
    if isinstance(cell, list):
        parts = [extract_value(c) for c in cell]
        return ", ".join(p for p in parts if p)
    return cell


def is_blank(cell):
    v = extract_value(cell)
    return v is None or (isinstance(v, str) and v.strip() == "")


def fmt_date(raw):
    v = extract_value(raw)
    if not v:
        return "-"
    s = str(v)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y")
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%d/%m/%Y")
        except ValueError:
            continue
    return s


def fmt_num(raw):
    v = extract_value(raw)
    try:
        return f"{float(v):,.0f}"
    except (TypeError, ValueError):
        return str(v) if v else "-"


def fetch_rows():
    base = f"https://coda.io/apis/v1/docs/{DOC_ID}/tables/{TABLE_ID}/rows"
    headers = {"Authorization": f"Bearer {CODA_API_TOKEN}"}
    visible_cols = [FILTER_COL, GROUP_COL] + [c for c, _ in COLUMNS]
    base_params = {"valueFormat": "simple", "limit": 500, "visibleColumns": ",".join(visible_cols)}

    rows = []
    page_token = None
    while True:
        params = {"pageToken": page_token} if page_token else base_params
        resp = requests.get(base, headers=headers, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        rows.extend(data.get("items", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
        time.sleep(0.2)
    return rows


def build_records(raw_rows):
    records = []
    for row in raw_rows:
        vals = row.get("values", {})
        if not is_blank(vals.get(FILTER_COL)):
            continue
        rec = {"Group": extract_value(vals.get(GROUP_COL)) or "(ไม่ระบุ)"}
        for col_id, key in COLUMNS:
            raw = vals.get(col_id)
            if key in DATE_KEYS:
                rec[key] = fmt_date(raw)
            elif key in NUM_KEYS:
                rec[key] = fmt_num(raw)
            else:
                v = extract_value(raw)
                rec[key] = str(v) if v not in (None, "") else "-"
        records.append(rec)

    records.sort(key=lambda r: (r["Group"], r["DO"], r["Account"]))
    return records


def pick_font(candidates, size):
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    print(f"::warning::No Thai TTF found among {candidates}, falling back to default font "
          f"(Thai text will not render correctly). Did the workflow install fonts-thai-tlwg?")
    return ImageFont.load_default()


def wrap_text(draw, text, font, max_width):
    words = str(text).split(" ")
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if not cur or draw.textlength(trial, font=font) <= max_width:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def render_image(records, out_path):
    font_title = pick_font(FONT_BOLD_CANDIDATES, 24)
    font_subtitle = pick_font(FONT_REGULAR_CANDIDATES, 14)
    font_header = pick_font(FONT_BOLD_CANDIDATES, 13)
    font_group = pick_font(FONT_BOLD_CANDIDATES, 14)
    font_bold_cell = pick_font(FONT_BOLD_CANDIDATES, 13)
    font_cell = pick_font(FONT_REGULAR_CANDIDATES, 13)
    font_footer = pick_font(FONT_REGULAR_CANDIDATES, 13)

    keys = [k for _, k in COLUMNS]
    col_widths = [COL_WIDTHS[k] for k in keys]
    total_col_width = GROUP_WIDTH + sum(col_widths)
    margin = 30
    canvas_width = total_col_width + margin * 2

    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))

    prod_width = COL_WIDTHS["ProdName"] - 16
    row_heights = []
    for r in records:
        lines = wrap_text(probe, r["ProdName"], font_cell, prod_width)
        line_h = font_cell.size + 6
        row_heights.append(max(58, len(lines) * line_h + 28))

    header_texts = [("รายการแจ้งเปลี่ยนแปลง", GROUP_WIDTH)] + [(HEADERS_TH[k], w) for k, w in zip(keys, col_widths)]
    max_header_lines = max(len(wrap_text(probe, text, font_header, w - 12)) for text, w in header_texts)

    title_area_h = 90
    header_h = max(52, max_header_lines * (font_header.size + 4) + 16)
    footer_area_h = 40
    total_rows_h = sum(row_heights)
    canvas_height = title_area_h + header_h + total_rows_h + footer_area_h if records else title_area_h + 40

    NAVY, GRAY = (30, 41, 90), (110, 110, 120)
    HEADER_BG, WHITE, DARK = (37, 58, 138), (255, 255, 255), (40, 40, 45)
    GROUP_BG, ALT_ROW_BG = (255, 244, 214), (250, 251, 255)
    BORDER, OUTER_BORDER = (228, 228, 235), (200, 200, 210)

    img = Image.new("RGB", (canvas_width, canvas_height), "white")
    draw = ImageDraw.Draw(img)

    draw.text((margin, 15), "รายการประชุม POS Daily Day", font=font_title, fill=NAVY)
    today_str = datetime.now().strftime("%d/%m/%Y")
    subtitle = f"รอคุยในที่ประชุม (ว่าง)  |  ตาราง {TABLE_ID}  |  ข้อมูล ณ วันที่ {today_str}"
    draw.text((margin, 50), subtitle, font=font_subtitle, fill=GRAY)

    if not records:
        draw.text((margin, title_area_h), "ไม่มีรายการ", font=font_footer, fill=GRAY)
        img.save(out_path)
        return

    table_top, table_left = title_area_h, margin

    def centered_text(x, y, w, h, text, font, fill):
        tw = draw.textlength(str(text), font=font)
        draw.text((x + max(6, (w - tw) / 2), y + h / 2 - font.size / 2), str(text), font=font, fill=fill)

    def wrapped_header_text(x, y, w, h, text, font, fill):
        lines = wrap_text(draw, text, font, w - 12)
        line_h = font.size + 4
        start_y = y + h / 2 - (len(lines) * line_h) / 2
        for j, line in enumerate(lines):
            tw = draw.textlength(line, font=font)
            draw.text((x + max(6, (w - tw) / 2), start_y + j * line_h), line, font=font, fill=fill)

    x = table_left
    draw.rectangle([x, table_top, x + GROUP_WIDTH, table_top + header_h], fill=HEADER_BG, outline=BORDER)
    wrapped_header_text(x, table_top, GROUP_WIDTH, header_h, "รายการแจ้งเปลี่ยนแปลง", font_header, WHITE)
    x += GROUP_WIDTH
    for k, w in zip(keys, col_widths):
        draw.rectangle([x, table_top, x + w, table_top + header_h], fill=HEADER_BG, outline=BORDER)
        wrapped_header_text(x, table_top, w, header_h, HEADERS_TH[k], font_header, WHITE)
        x += w

    y = table_top + header_h
    row_y_positions = []
    for i, r in enumerate(records):
        row_y_positions.append(y)
        h = row_heights[i]
        bg = ALT_ROW_BG if i % 2 == 0 else WHITE
        x = table_left + GROUP_WIDTH
        for k, w in zip(keys, col_widths):
            draw.rectangle([x, y, x + w, y + h], fill=bg, outline=BORDER)
            font = font_bold_cell if k == "Account" else font_cell
            if k == "ProdName":
                lines = wrap_text(draw, r[k], font, w - 16)
                ly = y + 6
                for line in lines:
                    draw.text((x + 8, ly), line, font=font, fill=DARK)
                    ly += font.size + 6
            else:
                centered_text(x, y, w, h, r[k], font, DARK)
            x += w
        y += h

    run_start, n = 0, len(records)
    for i in range(1, n + 1):
        boundary = (i == n) or (records[i]["Group"] != records[run_start]["Group"])
        if boundary:
            run_end = i - 1
            top_y = row_y_positions[run_start]
            bottom_y = row_y_positions[run_end] + row_heights[run_end]
            group_h = bottom_y - top_y
            count = run_end - run_start + 1
            label = f"{records[run_start]['Group']} ({count})"
            draw.rectangle([table_left, top_y, table_left + GROUP_WIDTH, top_y + group_h], fill=GROUP_BG, outline=BORDER)
            ly = top_y + 8
            for line in wrap_text(draw, label, font_group, GROUP_WIDTH - 16):
                draw.text((table_left + 8, ly), line, font=font_group, fill=DARK)
                ly += font_group.size + 4
            run_start = i

    draw.rectangle(
        [table_left, table_top, table_left + total_col_width, table_top + header_h + total_rows_h],
        outline=OUTER_BORDER, width=2,
    )

    footer_y = table_top + header_h + total_rows_h + 10
    draw.text((table_left, footer_y), f"รวมทั้งหมด {len(records)} รายการ", font=font_footer, fill=GRAY)

    img.save(out_path)


def send_to_lark(image_path):
    auth_resp = requests.post(
        "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": LARK_APP_ID, "app_secret": LARK_APP_SECRET},
        timeout=30,
    )
    auth_resp.raise_for_status()
    token = auth_resp.json()["tenant_access_token"]

    with open(image_path, "rb") as f:
        upload_resp = requests.post(
            "https://open.larksuite.com/open-apis/im/v1/images",
            headers={"Authorization": f"Bearer {token}"},
            data={"image_type": "message"},
            files={"image": ("pos_daily_grouped.png", f, "image/png")},
            timeout=60,
        )
    upload_resp.raise_for_status()
    image_key = upload_resp.json()["data"]["image_key"]

    send_resp = requests.post(
        LARK_WEBHOOK_URL,
        json={"msg_type": "image", "content": {"image_key": image_key}},
        timeout=30,
    )
    send_resp.raise_for_status()
    result = send_resp.json()
    print("SEND_RESP:", json.dumps(result, ensure_ascii=False))
    if result.get("code") != 0:
        print("::error::Lark send failed:", result)
        sys.exit(1)


def main():
    raw_rows = fetch_rows()
    print(f"Fetched {len(raw_rows)} raw rows from Coda table {TABLE_ID}")
    records = build_records(raw_rows)
    print(f"{len(records)} rows match filter (รอคุยในที่ประชุม is blank)")
    out_path = "pos_daily_grouped.png"
    render_image(records, out_path)
    print(f"Saved image: {out_path}")
    send_to_lark(out_path)


if __name__ == "__main__":
    main()
