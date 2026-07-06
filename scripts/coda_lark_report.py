#!/usr/bin/env python3
"""
POS Daily Lark report.

Pulls rows from Coda tables, each filtered to a different subset of
in-progress work, renders a grouped table image per report (merged group
cells, wrapped product names), and posts each image to a Lark group via
incoming webhook, in this order:

  1. รายการลงผลิตใหม่ รอเลือก PD/PU -- master DO-Shipment table
     (table-1mLj_7ktbc) filtered to rows where
     Status_DO-Shipment = "OP เลือก PD/PU".
  2. รายการประชุม POS Daily Day (รายการแจ้งเปลี่ยนแปลง) -- meeting table
     (table-OA56XddNFI) filtered to rows where "รอคุยในที่ประชุม" is blank.
  3. รายการเช็คแผนการผลิตจองคิวผลิต -- production-queue table
     (grid-z9ENI7PaD5) filtered to rows where (Status is not
     "จองคิวผลิตแล้ว"/"ยกเลิกการเช็คแผนผลิต" OR Order-Shipment is blank)
     AND Created is after 10:00 Asia/Bangkok yesterday.
  4. รอแจ้ง/Hold/ยกเลิก -- same table and columns as report 1, filtered
     to rows where Status_DO-Shipment is "ยกเลิก", "Hold", or "รอแจ้ง".

Required environment variables (set as GitHub Actions secrets):
  CODA_API_TOKEN     Coda API token (coda.io -> Account Settings -> API Settings)
  LARK_APP_ID        Lark custom app id
  LARK_APP_SECRET    Lark custom app secret
  LARK_WEBHOOK_URL   Full Lark incoming-webhook URL

Optional:
  CODA_DOC_ID              default "MiXbfRif1m"
  CODA_TABLE_ID            default "table-OA56XddNFI"     (meeting report)
  CODA_TABLE_ID_OP_PDPU    default "table-1mLj_7ktbc"     (OP เลือก PD/PU report)
  CODA_TABLE_ID_PROD_QUEUE default "grid-z9ENI7PaD5"      (production-queue report)
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from PIL import Image, ImageDraw, ImageFont

CODA_API_TOKEN = os.environ["CODA_API_TOKEN"]
LARK_APP_ID = os.environ["LARK_APP_ID"]
LARK_APP_SECRET = os.environ["LARK_APP_SECRET"]
LARK_WEBHOOK_URL = os.environ["LARK_WEBHOOK_URL"]

DOC_ID = os.environ.get("CODA_DOC_ID", "MiXbfRif1m")
TABLE_ID = os.environ.get("CODA_TABLE_ID", "table-OA56XddNFI")
TABLE_ID_OP_PDPU = os.environ.get("CODA_TABLE_ID_OP_PDPU", "table-1mLj_7ktbc")
TABLE_ID_PROD_QUEUE = os.environ.get("CODA_TABLE_ID_PROD_QUEUE", "grid-z9ENI7PaD5")

FILTER_COL = "c-i7ekT7SOM_"  # รอคุยในที่ประชุม -- must be blank to include the row
STATUS_COL = "c-HvRU96fdFo"  # Status_DO-Shipment
STATUS_FILTER_VALUE = "OP เลือก PD/PU"
STATUS_INCLUDE_HOLD = {"ยกเลิก", "Hold", "รอแจ้ง"}
GROUP_COL = "c-jF5iOvd80f"  # รายการแจ้งเปลี่ยนแปลง -- merged group column

# --- report 1 schema (meeting table) ---
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
    "Account": 240, "DO": 145, "OrderQty": 95, "ShipQty": 105, "Unit": 50,
    "PDPU": 65, "MOPR": 110, "ProdCode": 110, "ProdName": 380, "CRD0": 95,
    "CRDEdit": 100, "LoadConfirm": 95, "ArriveDate": 100, "Status": 160,
}
GROUP_WIDTH = 200
SORT_KEYS = ["DO", "Account"]

# --- report 1 schema (OP เลือก PD/PU, grouped by วันแจ้งPOS) ---
NOTIFY_DATE_COL_OP_PDPU = "c-n3S3kQntLR"  # วันแจ้งPOS -- group column

COLUMNS_OP_PDPU = [
    ("c-lCcIWuw_5l", "DO"),
    ("c-q7-C1QWCWh", "PDPUMain"),
    ("c-qKzCANG9Mi", "AccountCode"),
    ("c-zk747feqUX", "Account"),
    ("c-hCqU5uBXTm", "ProdCode"),
    ("c-8U2jOYy6u7", "ProdName"),
    ("c-PVu77YUoUi", "ShipQty"),
    ("c-UYhihPAYaK", "Unit"),
    ("c-5h8f1Bhotx", "CRD"),
]
DATE_KEYS_OP_PDPU = {"CRD"}
NUM_KEYS_OP_PDPU = {"ShipQty"}

HEADERS_TH_OP_PDPU = {
    "DO": "DO-shipment",
    "PDPUMain": "PD/PU Main",
    "AccountCode": "Account Code",
    "Account": "Account Name",
    "ProdCode": "Product Code",
    "ProdName": "Product Name",
    "ShipQty": "Shipment-Qty",
    "Unit": "Unit",
    "CRD": "CRD",
}
COL_WIDTHS_OP_PDPU = {
    "DO": 145, "PDPUMain": 70, "AccountCode": 100, "Account": 200,
    "ProdCode": 110, "ProdName": 380, "ShipQty": 105, "Unit": 55, "CRD": 95,
}
GROUP_WIDTH_OP_PDPU = 130
SORT_KEYS_OP_PDPU = ["DO", "Account"]

# --- report 3 schema (production-queue table) ---
STATUS_COL_PQ = "c-B0Rs5QyYq3"  # Status
ORDER_SHIPMENT_COL_PQ = "c-IrtKcErAtQ"
CREATED_COL_PQ = "c-kJEll1twNl"  # Created(thisRow)
PDPU_COL_PQ = "c-e3K7rOgynm"  # PD/PU -- group column (with Account Name)
ACCOUNT_COL_PQ = "c-zZsm603C_I"  # Account Name -- group column (with PD/PU)
STATUS_EXCLUDE_PQ = {"จองคิวผลิตแล้ว", "ยกเลิกการเช็คแผนผลิต"}

BANGKOK_TZ = timezone(timedelta(hours=7))


def to_bangkok_naive(dt):
    if dt.tzinfo is not None:
        dt = dt.astimezone(BANGKOK_TZ)
    return dt.replace(tzinfo=None)


def parse_datetime(raw):
    v = extract_value(raw)
    if not v:
        return None
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return to_bangkok_naive(dt)


# "Created หลัง 10 โมงเช้าของเมื่อวาน" -- yesterday 10:00 Asia/Bangkok, computed at run time
CREATED_CUTOFF_PQ = (to_bangkok_naive(datetime.now(timezone.utc)) - timedelta(days=1)).replace(
    hour=10, minute=0, second=0, microsecond=0
)

COLUMNS_PQ = [
    ("c-KYT8U1bMj2", "SONo"),
    ("c-7PpTcmbFqx", "CRD"),
    ("c-hJnPkumoJi", "ProdCode"),
    ("c-cjNDgE7Usl", "ProdName"),
    ("c-jMBvRwlGzR", "Qty"),
    ("c-TG-qapwpxJ", "Unit"),
    ("c-B0Rs5QyYq3", "Status"),
    ("c-9Q0RIXGS67", "CATRoll"),
    ("c-PgYQ3ZS1Vc", "DeliveryPoint"),
    ("c-RnPi8PfSdM", "Sales"),
]
DATE_KEYS_PQ = {"CRD"}
NUM_KEYS_PQ = {"Qty"}

HEADERS_TH_PQ = {
    "SONo": "SO No.",
    "CRD": "CRD",
    "ProdCode": "Product Code",
    "ProdName": "Product Name",
    "Qty": "Qty",
    "Unit": "Unit",
    "Status": "Status",
    "CATRoll": "CAT Roll",
    "DeliveryPoint": "จุดส่ง",
    "Sales": "Sales",
}
COL_WIDTHS_PQ = {
    "SONo": 120, "CRD": 95, "ProdCode": 110,
    "ProdName": 340, "Qty": 90, "Unit": 55, "Status": 190, "CATRoll": 150,
    "DeliveryPoint": 100, "Sales": 160,
}
GROUP_WIDTH_PQ = 220
SORT_KEYS_PQ = ["CRD", "SONo"]

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


def fetch_rows(table_id, visible_cols):
    base = f"https://coda.io/apis/v1/docs/{DOC_ID}/tables/{table_id}/rows"
    headers = {"Authorization": f"Bearer {CODA_API_TOKEN}"}
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


def build_records(raw_rows, matches, columns, date_keys, num_keys, group_col, sort_keys, group_date_cols=frozenset()):
    records = []
    for row in raw_rows:
        vals = row.get("values", {})
        if not matches(vals):
            continue
        rec = {}
        if group_col:
            group_cols = group_col if isinstance(group_col, tuple) else (group_col,)
            parts = []
            for c in group_cols:
                raw = vals.get(c)
                part = fmt_date(raw) if c in group_date_cols else str(extract_value(raw) or "")
                parts.append(part if part != "-" else "")
            rec["Group"] = " / ".join(p for p in parts if p) or "(ไม่ระบุ)"
        for col_id, key in columns:
            raw = vals.get(col_id)
            if key in date_keys:
                rec[key] = fmt_date(raw)
            elif key in num_keys:
                rec[key] = fmt_num(raw)
            else:
                v = extract_value(raw)
                rec[key] = str(v) if v not in (None, "") else "-"
        records.append(rec)

    group_prefix = ["Group"] if group_col else []
    records.sort(key=lambda r: tuple([r[k] for k in group_prefix + sort_keys]))
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


def fit_text_font(draw, text, font, max_width, min_size=9):
    text = str(text)
    if not hasattr(font, "path") or draw.textlength(text, font=font) <= max_width:
        return font
    size = font.size
    fitted = font
    while draw.textlength(text, font=fitted) > max_width and size > min_size:
        size -= 1
        fitted = ImageFont.truetype(font.path, size)
    return fitted


def render_image(records, out_path, title, columns, headers_th, col_widths, group_width, group_label, wrap_key=None):
    grouped = bool(group_label) and group_width > 0
    if not grouped:
        group_width = 0

    font_title = pick_font(FONT_BOLD_CANDIDATES, 24)
    font_subtitle = pick_font(FONT_REGULAR_CANDIDATES, 14)
    font_header = pick_font(FONT_BOLD_CANDIDATES, 12)
    font_group = pick_font(FONT_BOLD_CANDIDATES, 14)
    font_badge = pick_font(FONT_BOLD_CANDIDATES, 13)
    font_bold_cell = pick_font(FONT_BOLD_CANDIDATES, 13)
    font_cell = pick_font(FONT_REGULAR_CANDIDATES, 13)
    font_footer = pick_font(FONT_REGULAR_CANDIDATES, 13)

    keys = [k for _, k in columns]
    col_ws = [col_widths[k] for k in keys]
    total_col_width = group_width + sum(col_ws)
    margin = 30
    canvas_width = total_col_width + margin * 2

    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))

    wrap_width = col_widths[wrap_key] - 16 if wrap_key else None
    row_heights = []
    for r in records:
        if wrap_key:
            lines = wrap_text(probe, r[wrap_key], font_cell, wrap_width)
            line_h = font_cell.size + 6
            row_heights.append(max(58, len(lines) * line_h + 28))
        else:
            row_heights.append(58)

    if grouped and records:
        badge_h = font_badge.size + 4 * 2
        run_start, n = 0, len(records)
        for i in range(1, n + 1):
            if (i == n) or (records[i]["Group"] != records[run_start]["Group"]):
                run_end = i - 1
                label_lines = wrap_text(probe, records[run_start]["Group"], font_group, group_width - 16)
                needed_h = 8 + badge_h + 6 + len(label_lines) * (font_group.size + 4) + 8
                shortfall = needed_h - sum(row_heights[run_start:run_end + 1])
                if shortfall > 0:
                    row_heights[run_end] += shortfall
                run_start = i

    header_texts = ([(group_label, group_width)] if grouped else []) + [(headers_th[k], w) for k, w in zip(keys, col_ws)]
    max_header_lines = max(len(wrap_text(probe, text, font_header, w - 12)) for text, w in header_texts)

    title_area_h = 90
    header_h = max(52, max_header_lines * (font_header.size + 4) + 16)
    footer_area_h = 40
    empty_row_h = 60
    total_rows_h = sum(row_heights) if records else empty_row_h
    canvas_height = title_area_h + header_h + total_rows_h + footer_area_h

    NAVY, GRAY = (30, 41, 90), (110, 110, 120)
    HEADER_BG, WHITE, DARK = (37, 58, 138), (255, 255, 255), (40, 40, 45)
    GROUP_BG, ALT_ROW_BG = (255, 244, 214), (250, 251, 255)
    BORDER, OUTER_BORDER = (228, 228, 235), (200, 200, 210)
    EMPTY_RED = (200, 30, 30)
    BADGE_BG = (214, 69, 40)

    img = Image.new("RGB", (canvas_width, canvas_height), "white")
    draw = ImageDraw.Draw(img)

    draw.text((margin, 15), title, font=font_title, fill=NAVY)
    today_str = datetime.now().strftime("%d/%m/%Y")
    subtitle = f"ข้อมูล ณ วันที่ {today_str}"
    draw.text((margin, 50), subtitle, font=font_subtitle, fill=GRAY)

    table_top, table_left = title_area_h, margin

    def centered_text(x, y, w, h, text, font, fill):
        max_width = w - 16
        font = fit_text_font(draw, text, font, max_width)
        tw = draw.textlength(str(text), font=font)
        draw.text((x + max(6, (w - tw) / 2), y + h / 2 - font.size / 2), str(text), font=font, fill=fill)

    def wrapped_header_text(x, y, w, h, text, font, fill):
        max_width = w - 12
        lines = wrap_text(draw, text, font, max_width)
        line_h = font.size + 4
        start_y = y + h / 2 - (len(lines) * line_h) / 2
        for j, line in enumerate(lines):
            line_font = fit_text_font(draw, line, font, max_width)
            tw = draw.textlength(line, font=line_font)
            draw.text((x + max(6, (w - tw) / 2), start_y + j * line_h), line, font=line_font, fill=fill)

    x = table_left
    if grouped:
        draw.rectangle([x, table_top, x + group_width, table_top + header_h], fill=HEADER_BG, outline=BORDER)
        wrapped_header_text(x, table_top, group_width, header_h, group_label, font_header, WHITE)
        x += group_width
    for k, w in zip(keys, col_ws):
        draw.rectangle([x, table_top, x + w, table_top + header_h], fill=HEADER_BG, outline=BORDER)
        wrapped_header_text(x, table_top, w, header_h, headers_th[k], font_header, WHITE)
        x += w

    y = table_top + header_h
    if records:
        row_y_positions = []
        for i, r in enumerate(records):
            row_y_positions.append(y)
            h = row_heights[i]
            bg = ALT_ROW_BG if i % 2 == 0 else WHITE
            x = table_left + group_width
            for k, w in zip(keys, col_ws):
                draw.rectangle([x, y, x + w, y + h], fill=bg, outline=BORDER)
                font = font_bold_cell if k == "Account" else font_cell
                if k == wrap_key:
                    lines = wrap_text(draw, r[k], font, w - 16)
                    ly = y + 6
                    for line in lines:
                        draw.text((x + 8, ly), line, font=font, fill=DARK)
                        ly += font.size + 6
                else:
                    centered_text(x, y, w, h, r[k], font, DARK)
                x += w
            y += h

        if grouped:
            run_start, n = 0, len(records)
            for i in range(1, n + 1):
                boundary = (i == n) or (records[i]["Group"] != records[run_start]["Group"])
                if boundary:
                    run_end = i - 1
                    top_y = row_y_positions[run_start]
                    bottom_y = row_y_positions[run_end] + row_heights[run_end]
                    group_h = bottom_y - top_y
                    count = run_end - run_start + 1
                    draw.rectangle([table_left, top_y, table_left + group_width, top_y + group_h], fill=GROUP_BG, outline=BORDER)

                    badge_text = f"{count} รายการ"
                    badge_pad_x, badge_pad_y = 8, 4
                    badge_tw = draw.textlength(badge_text, font=font_badge)
                    badge_w = badge_tw + badge_pad_x * 2
                    badge_h = font_badge.size + badge_pad_y * 2
                    badge_x, badge_y = table_left + 8, top_y + 8
                    draw.rounded_rectangle(
                        [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h], radius=badge_h / 2, fill=BADGE_BG,
                    )
                    draw.text((badge_x + badge_w / 2, badge_y + badge_h / 2), badge_text, font=font_badge, fill=WHITE, anchor="mm")

                    ly = badge_y + badge_h + 6
                    for line in wrap_text(draw, records[run_start]["Group"], font_group, group_width - 16):
                        draw.text((table_left + 8, ly), line, font=font_group, fill=DARK)
                        ly += font_group.size + 4
                    run_start = i
    else:
        draw.rectangle([table_left, y, table_left + total_col_width, y + empty_row_h], fill=ALT_ROW_BG, outline=BORDER)
        centered_text(table_left, y, total_col_width, empty_row_h, "ไม่มีรายการ", font_cell, EMPTY_RED)

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
            files={"image": (os.path.basename(image_path), f, "image/png")},
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


REPORTS = [
    {
        "table_id": TABLE_ID_OP_PDPU,
        "title": "รายการลงผลิตใหม่ รอเลือก PD/PU",
        "extra_filter_cols": [STATUS_COL],
        "matches": lambda vals: extract_value(vals.get(STATUS_COL)) == STATUS_FILTER_VALUE,
        "filter_desc": f"Status_DO-Shipment = {STATUS_FILTER_VALUE}",
        "group_col": NOTIFY_DATE_COL_OP_PDPU,
        "group_label": "วันแจ้งPOS",
        "group_width": GROUP_WIDTH_OP_PDPU,
        "group_date_cols": {NOTIFY_DATE_COL_OP_PDPU},
        "columns": COLUMNS_OP_PDPU,
        "headers": HEADERS_TH_OP_PDPU,
        "col_widths": COL_WIDTHS_OP_PDPU,
        "date_keys": DATE_KEYS_OP_PDPU,
        "num_keys": NUM_KEYS_OP_PDPU,
        "sort_keys": SORT_KEYS_OP_PDPU,
        "wrap_key": "ProdName",
        "out_path": "pos_op_pdpu_grouped.png",
    },
    {
        "table_id": TABLE_ID,
        "title": "รายการประชุม POS Daily Day",
        "extra_filter_cols": [FILTER_COL],
        "matches": lambda vals: is_blank(vals.get(FILTER_COL)),
        "filter_desc": "รอคุยในที่ประชุม is blank",
        "group_col": GROUP_COL,
        "group_label": "รายการแจ้งเปลี่ยนแปลง",
        "group_width": GROUP_WIDTH,
        "columns": COLUMNS,
        "headers": HEADERS_TH,
        "col_widths": COL_WIDTHS,
        "date_keys": DATE_KEYS,
        "num_keys": NUM_KEYS,
        "sort_keys": SORT_KEYS,
        "wrap_key": "ProdName",
        "out_path": "pos_daily_grouped.png",
    },
    {
        "table_id": TABLE_ID_PROD_QUEUE,
        "title": "รายการเช็คแผนการผลิตจองคิวผลิต",
        "extra_filter_cols": [ORDER_SHIPMENT_COL_PQ, CREATED_COL_PQ],
        "matches": lambda vals: (
            extract_value(vals.get(STATUS_COL_PQ)) not in STATUS_EXCLUDE_PQ
            or is_blank(vals.get(ORDER_SHIPMENT_COL_PQ))
        )
        and (lambda dt: dt is not None and dt > CREATED_CUTOFF_PQ)(parse_datetime(vals.get(CREATED_COL_PQ))),
        "filter_desc": (
            "(Status not in {จองคิวผลิตแล้ว, ยกเลิกการเช็คแผนผลิต} OR Order-Shipment blank) "
            f"AND Created > {CREATED_CUTOFF_PQ.isoformat()} (Asia/Bangkok)"
        ),
        "group_col": (PDPU_COL_PQ, ACCOUNT_COL_PQ),
        "group_label": "PD/PU / Account Name",
        "group_width": GROUP_WIDTH_PQ,
        "columns": COLUMNS_PQ,
        "headers": HEADERS_TH_PQ,
        "col_widths": COL_WIDTHS_PQ,
        "date_keys": DATE_KEYS_PQ,
        "num_keys": NUM_KEYS_PQ,
        "sort_keys": SORT_KEYS_PQ,
        "wrap_key": "ProdName",
        "out_path": "pos_prod_queue_grouped.png",
    },
    {
        "table_id": TABLE_ID_OP_PDPU,
        "title": "รอแจ้ง/Hold/ยกเลิก",
        "extra_filter_cols": [],
        "matches": lambda vals: extract_value(vals.get(STATUS_COL)) in STATUS_INCLUDE_HOLD,
        "filter_desc": f"Status_DO-Shipment in {sorted(STATUS_INCLUDE_HOLD)}",
        "group_col": GROUP_COL,
        "group_label": "รายการแจ้งเปลี่ยนแปลง",
        "group_width": GROUP_WIDTH,
        "columns": COLUMNS,
        "headers": HEADERS_TH,
        "col_widths": COL_WIDTHS,
        "date_keys": DATE_KEYS,
        "num_keys": NUM_KEYS,
        "sort_keys": SORT_KEYS,
        "wrap_key": "ProdName",
        "out_path": "pos_hold_cancel_grouped.png",
    },
]


def main():
    for report in REPORTS:
        print(f"--- {report['title']} (table {report['table_id']}) ---")
        gc = report["group_col"]
        group_cols = list(gc) if isinstance(gc, tuple) else ([gc] if gc else [])
        visible_cols = group_cols + report["extra_filter_cols"] + [c for c, _ in report["columns"]]
        raw_rows = fetch_rows(report["table_id"], visible_cols)
        print(f"Fetched {len(raw_rows)} raw rows from Coda table {report['table_id']}")
        records = build_records(
            raw_rows, report["matches"], report["columns"], report["date_keys"], report["num_keys"],
            report["group_col"], report["sort_keys"], report.get("group_date_cols", frozenset()),
        )
        print(f"{len(records)} rows match filter ({report['filter_desc']})")
        render_image(
            records, report["out_path"], report["title"],
            report["columns"], report["headers"], report["col_widths"], report["group_width"],
            report["group_label"], report["wrap_key"],
        )
        print(f"Saved image: {report['out_path']}")
        send_to_lark(report["out_path"])


if __name__ == "__main__":
    main()
