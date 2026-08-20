#!/usr/bin/env python3
"""Build the two human-review PDFs for the scoped RU pilot."""

from __future__ import annotations

import html
import json
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT_PATH = ROOT / "PILOT_RU_RUNTIME_SNAPSHOTS_2026-08-20.json"
REVIEW_PDF = ROOT / "PILOT_RU_RUNTIME_COPY_REVIEW_2026-08-20.pdf"
SIGNOFF_PDF = ROOT / "PILOT_CLINICAL_SIGNOFF_APP001_004_SARINA_TT_2026-08-20_FOR_SIGNATURE.pdf"

INK = colors.HexColor("#162536")
MUTED = colors.HexColor("#526170")
BLUE = colors.HexColor("#176B87")
PALE_BLUE = colors.HexColor("#EAF5F8")
PALE_GREY = colors.HexColor("#F3F5F7")
PALE_AMBER = colors.HexColor("#FFF5D7")
AMBER = colors.HexColor("#8B5A00")
RED = colors.HexColor("#A82020")


def register_fonts() -> None:
    font_dir = Path("/System/Library/Fonts/Supplemental")
    pdfmetrics.registerFont(TTFont("Arial", str(font_dir / "Arial.ttf")))
    pdfmetrics.registerFont(TTFont("Arial-Bold", str(font_dir / "Arial Bold.ttf")))
    pdfmetrics.registerFont(TTFont("Arial-Italic", str(font_dir / "Arial Italic.ttf")))
    pdfmetrics.registerFont(TTFont("Arial-BoldItalic", str(font_dir / "Arial Bold Italic.ttf")))
    pdfmetrics.registerFontFamily(
        "Arial",
        normal="Arial",
        bold="Arial-Bold",
        italic="Arial-Italic",
        boldItalic="Arial-BoldItalic",
    )


def styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "TitleRU", parent=base["Title"], fontName="Arial-Bold", fontSize=21,
            leading=25, textColor=INK, alignment=TA_LEFT, spaceAfter=8 * mm,
        ),
        "subtitle": ParagraphStyle(
            "SubtitleRU", fontName="Arial", fontSize=10, leading=14,
            textColor=MUTED, spaceAfter=5 * mm,
        ),
        "h1": ParagraphStyle(
            "Heading1RU", parent=base["Heading1"], fontName="Arial-Bold",
            fontSize=15, leading=18, textColor=BLUE, spaceBefore=6 * mm,
            spaceAfter=3 * mm,
        ),
        "h2": ParagraphStyle(
            "Heading2RU", parent=base["Heading2"], fontName="Arial-Bold",
            fontSize=11, leading=14, textColor=INK, spaceBefore=3 * mm,
            spaceAfter=2 * mm,
        ),
        "body": ParagraphStyle(
            "BodyRU", parent=base["BodyText"], fontName="Arial", fontSize=9,
            leading=12.5, textColor=INK, spaceAfter=2.5 * mm,
        ),
        "small": ParagraphStyle(
            "SmallRU", fontName="Arial", fontSize=7.4, leading=9.6,
            textColor=MUTED,
        ),
        "meta": ParagraphStyle(
            "MetaRU", fontName="Arial", fontSize=8, leading=10.5,
            textColor=MUTED,
        ),
        "status": ParagraphStyle(
            "StatusRU", fontName="Arial-Bold", fontSize=7.6, leading=9.5,
            textColor=AMBER,
        ),
        "draft": ParagraphStyle(
            "DraftRU", fontName="Arial-Bold", fontSize=13, leading=16,
            textColor=RED, alignment=TA_CENTER, spaceAfter=4 * mm,
        ),
        "center": ParagraphStyle(
            "CenterRU", fontName="Arial", fontSize=9, leading=12,
            textColor=INK, alignment=TA_CENTER,
        ),
    }


def safe(value: object) -> str:
    return html.escape(str(value or ""), quote=False)


def para_text(value: object) -> str:
    escaped = safe(value)
    escaped = escaped.replace("\n", "<br/>")
    escaped = re.sub(r"•\s*", "&#8226;&nbsp;", escaped)
    return escaped


def page_footer(canvas, doc, *, title: str, draft: bool = False) -> None:
    canvas.saveState()
    width, height = A4
    canvas.setFont("Arial", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10 * mm, title)
    canvas.drawRightString(width - 18 * mm, 10 * mm, f"Страница {doc.page}")
    if draft:
        canvas.setFont("Arial-Bold", 10)
        canvas.setFillColor(RED)
        canvas.drawCentredString(width / 2, height - 11 * mm, "DRAFT: SIGNATURE REQUIRED")
        canvas.setFillAlpha(0.07)
        canvas.setFont("Arial-Bold", 37)
        canvas.translate(width / 2, height / 2)
        canvas.rotate(32)
        canvas.drawCentredString(0, 0, "DRAFT: SIGNATURE REQUIRED")
    canvas.restoreState()


def review_entry_card(entry: dict, st: dict):
    case_phase = "Общий интерфейс"
    if entry.get("case_id"):
        case_phase = f"{entry['case_id']} · {entry.get('phase') or '—'}"
    heading = Paragraph(safe(entry["screen"]), st["h2"])
    metadata = Paragraph(
        f"{safe(case_phase)} · состояние: {safe(entry['runtime_state'])}", st["meta"]
    )
    status = Paragraph(safe(entry["status"]), st["status"])
    header = Table([[heading, status]], colWidths=[142 * mm, 28 * mm])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    text = Paragraph(para_text(entry["text"]), st["body"])
    source_list = "<br/>".join(safe(path) for path in entry.get("source_files", []))
    source = Paragraph(f"Исходные файлы:<br/>{source_list}", st["small"])
    note_value = entry.get("note") or "—"
    note = Paragraph(f"Примечание:<br/>{para_text(note_value)}", st["small"])
    source_note = Table([[source, note]], colWidths=[85 * mm, 85 * mm])
    source_note.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 1 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    card = Table([[header], [metadata], [text], [source_note]], colWidths=[174 * mm])
    card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_GREY),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#D8DEE4")),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2.2 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2 * mm),
    ]))
    return KeepTogether([card, Spacer(1, 2.5 * mm)])


def build_review_pdf(snapshot: dict, st: dict) -> None:
    doc = SimpleDocTemplate(
        str(REVIEW_PDF), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=17 * mm, title="ON QOL — RU runtime copy review",
        author="ON QOL", creator="ON QOL pilot evidence builder",
    )
    story = [
        Paragraph("ON QOL · проверка фактически отображаемого русского текста", st["title"]),
        Paragraph(
            "20.08.2026 · APP-001–APP-004 · русский язык · REFERENCE-FULL · "
            "режим реального стационара отключён · N=8 резидентов",
            st["subtitle"],
        ),
        Table(
            [[Paragraph("Статус допуска", st["meta"]), Paragraph("ru_language_review = pending", st["status"])],
             [Paragraph("Идентификатор", st["meta"]), Paragraph("ONQOL-REFERENCE-FULL-20260820", st["body"])],
             [Paragraph("Объём проверки", st["meta"]), Paragraph(
                 f"{snapshot['counts']['runtime_review_entries']} достижимых записей · "
                 f"{snapshot['counts']['unique_rendered_text_blocks']} уникальных отображаемых блоков",
                 st["body"],
             )]],
            colWidths=[42 * mm, 128 * mm],
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), PALE_AMBER),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#E3D3A7")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5 * mm),
            ]),
        ),
        Spacer(1, 5 * mm),
        Paragraph("Как сформирован пакет", st["h1"]),
        Paragraph(
            "В пакет вошёл только текст, который воспроизводимо достигается в активном "
            "маршруте пилота. Стартовые экраны используют тот же модуль русского текста, "
            "что и рабочий интерфейс; кейсы создаются через createV25Session в режиме "
            "reference и проходят через advanceV25Session. Структурированное доказательство "
            "хранится в PILOT_RU_RUNTIME_SNAPSHOTS_2026-08-20.json.",
            st["body"],
        ),
        Paragraph(
            "Ни один блок не отмечен как одобренный автоматически. Решение владельца "
            "русского текста и подпись отсутствуют, поэтому все 50 записей сохраняют "
            "статус needs owner review.",
            st["body"],
        ),
    ]

    for index, entry in enumerate(snapshot["entries"]):
        if index == 0:
            story.append(Paragraph("Общий интерфейс", st["h1"]))
        elif entry.get("case_id") and not snapshot["entries"][index - 1].get("case_id"):
            story.append(Paragraph("Кейсы и результаты обследования", st["h1"]))
        elif entry.get("id") == "phase-primary-assessment":
            story.append(Paragraph("Основные фазы, наставник и завершение", st["h1"]))
        story.append(review_entry_card(entry, st))

    story.extend([
        Paragraph("Не применимо к этому пилоту", st["h1"]),
        Table(
            [[Paragraph("Элемент", st["h2"]), Paragraph("Почему не входит", st["h2"])]] +
            [[Paragraph(safe(item["scope"]), st["body"]), Paragraph(para_text(item["note"]), st["body"])]
             for item in snapshot["exclusions"]],
            colWidths=[65 * mm, 105 * mm], repeatRows=1,
            style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), PALE_BLUE),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CDD8DE")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
            ]),
        ),
        Paragraph("Решение владельца", st["h1"]),
        Paragraph("Ревьюер: _________________________________________________", st["body"]),
        Paragraph("Роль: _____________________________________________________", st["body"]),
        Paragraph("Решение:  □ одобрено    □ одобрено с условиями    □ отклонено", st["body"]),
        Paragraph("Дата: ____________________    Подпись: __________________________", st["body"]),
        Paragraph("Комментарии:", st["body"]),
        Spacer(1, 18 * mm),
        HRFlowable(width="100%", thickness=0.6, color=MUTED),
        Spacer(1, 2 * mm),
        Paragraph(
            "До заполнения этого блока pilotReleaseApprovals.js сохраняет "
            "ru_language_review.status = pending.",
            st["small"],
        ),
    ])
    doc.build(
        story,
        onFirstPage=lambda c, d: page_footer(c, d, title="RU runtime copy review"),
        onLaterPages=lambda c, d: page_footer(c, d, title="RU runtime copy review"),
    )


def checklist_table(rows: list[list[str]], st: dict, widths: list[float]):
    data = [[Paragraph(para_text(cell), st["body"]) for cell in row] for row in rows]
    return Table(data, colWidths=widths, repeatRows=1, style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PALE_BLUE),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#BFCBD2")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5 * mm),
    ]))


def build_signoff_pdf(st: dict) -> None:
    doc = SimpleDocTemplate(
        str(SIGNOFF_PDF), pagesize=A4, rightMargin=20 * mm, leftMargin=20 * mm,
        topMargin=23 * mm, bottomMargin=17 * mm,
        title="ON QOL — pilot clinical sign-off draft",
        author="ON QOL", creator="ON QOL pilot evidence builder",
    )
    story = [
        Paragraph("DRAFT: SIGNATURE REQUIRED", st["draft"]),
        Paragraph("ON QOL · клинический допуск ограниченного пилота", st["title"]),
        Paragraph(
            "Форма для независимого клинического ревью. Этот документ не является "
            "одобрением, пока решение, дата и подпись не заполнены фактически.",
            st["subtitle"],
        ),
        Paragraph("Точный объём решения", st["h1"]),
        checklist_table([
            ["Параметр", "Объём"],
            ["Когорта", "N=8 резидентов общей хирургии"],
            ["Язык", "Русский"],
            ["Кейсы", "APP-001, APP-002, APP-003, APP-004"],
            ["Маршрут", "REFERENCE-FULL; учебный профиль, не описание реального стационара"],
            ["Исключено", "Режим реального стационара, APP-005, осложнения, альтернативные скрытые диагнозы, числовая оценка"],
            ["Назначение", "Небольшой формирующий пилот; не суммативная аттестация"],
            ["Resource approval ID", "ONQOL-REFERENCE-FULL-20260820"],
        ], st, [48 * mm, 122 * mm]),
        Paragraph("Почему подготовлена эта форма", st["h1"]),
        Paragraph(
            "В репозитории не найден подписанный документ, который одновременно покрывает "
            "весь стабильный путь APP-001–APP-004 и точный объём пилота выше. Найденные "
            "артефакты нельзя объединять в подразумеваемое одобрение:",
            st["body"],
        ),
        Paragraph(
            "• REVIEW_PACKAGE_APPENDICITIS_v1.1.md — отдельный пакет правил; его scope "
            "не охватывает весь pilot-wide runtime.<br/>"
            "• DOSING_RULES_CLINICAL_REVIEW_v0.2_2026-08-20.md — только три явно "
            "перечисленных дозовых правила; сам документ запрещает расширять этот approval.",
            st["body"],
        ),
        Paragraph(
            "До фактической подписи manifest обязан сохранять clinical_signoff.status = pending.",
            st["status"],
        ),
        PageBreak(),
        Paragraph("DRAFT: SIGNATURE REQUIRED", st["draft"]),
        Paragraph("Матрица клинического ревью", st["title"]),
        Paragraph(
            "Для каждого кейса отметьте решение и укажите условия или исправления. "
            "Пустая строка не считается одобрением.", st["body"],
        ),
        checklist_table([
            ["Кейс", "Проверяемый объём", "Решение / условия"],
            ["APP-001", "Истина пациента; анамнез и осмотр; исследования; дифференциальный ряд; тактика и маршрутизация", "□ одобрено\n□ с условиями\n□ отклонено\n\n____________________"],
            ["APP-002", "Стабильный полный путь: оценка, исследования, операция, послеоперационное наблюдение, выписка", "□ одобрено\n□ с условиями\n□ отклонено\n\n____________________"],
            ["APP-003", "Истина пациента; тазовая локализация; исследования; опасные альтернативы; тактика", "□ одобрено\n□ с условиями\n□ отклонено\n\n____________________"],
            ["APP-004", "Истина пациента; ретроцекальная локализация; исследования; мочевые альтернативы; тактика", "□ одобрено\n□ с условиями\n□ отклонено\n\n____________________"],
        ], st, [23 * mm, 94 * mm, 53 * mm]),
        Paragraph("Обязательные области общей проверки", st["h1"]),
        Paragraph(
            "□ Клинические данные и их временная динамика согласованы.<br/>"
            "□ Допустимые гипотезы не превращаются в преждевременное подтверждение диагноза.<br/>"
            "□ Минимально необходимые действия и условия смены тактики сформулированы корректно.<br/>"
            "□ Исследования, лечение, операция и маршрутизация не выходят за подтверждённый scope.<br/>"
            "□ Формирующий разбор не выдаёт числовой балл и не утверждает клиническую правильность автоматически.<br/>"
            "□ Медикаменты и дозы разрешены только в пределах отдельно подписанного реестра.",
            st["body"],
        ),
        Paragraph("Условия / обязательные исправления", st["h1"]),
        Spacer(1, 34 * mm),
        HRFlowable(width="100%", thickness=0.6, color=MUTED),
        PageBreak(),
        Paragraph("DRAFT: SIGNATURE REQUIRED", st["draft"]),
        Paragraph("Решение и подпись", st["title"]),
        Paragraph(
            "Ревьюер подтверждает только выбранное ниже решение и только для точного объёма "
            "на первой странице. Подпись не распространяется на KK, реальные профили "
            "стационаров, APP-005, осложнения, альтернативные заболевания или числовое оценивание.",
            st["body"],
        ),
        Spacer(1, 4 * mm),
        checklist_table([
            ["Поле", "Заполняется ревьюером"],
            ["Ревьюер", "Сарина Т.Т."],
            ["Роль", "Независимый клинический ревьюер: ______________________________"],
            ["Решение", "□ Одобрено для ограниченного формирующего пилота\n□ Одобрено с условиями\n□ Отклонено"],
            ["Дата фактического ревью", "____ / ____ / 2026"],
            ["Подпись", "\n\n_______________________________________________"],
        ], st, [53 * mm, 117 * mm]),
        Paragraph("Условия решения / комментарии", st["h1"]),
        Spacer(1, 45 * mm),
        HRFlowable(width="100%", thickness=0.6, color=MUTED),
        Spacer(1, 5 * mm),
        Paragraph("После получения подписи", st["h1"]),
        Paragraph(
            "Сохранить подписанный артефакт как "
            "PILOT_CLINICAL_SIGNOFF_APP001_004_SARINA_TT_2026-08-20.pdf либо под "
            "эквивалентным именем с тем же exact scope. Только затем внести reviewer, "
            "approved_at, evidence и approval_id в pilotReleaseApprovals.js. Код сам по "
            "себе не закрывает этот gate.",
            st["body"],
        ),
    ]
    doc.build(
        story,
        onFirstPage=lambda c, d: page_footer(c, d, title="Clinical sign-off form", draft=True),
        onLaterPages=lambda c, d: page_footer(c, d, title="Clinical sign-off form", draft=True),
    )


def main() -> None:
    register_fonts()
    st = styles()
    snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    build_review_pdf(snapshot, st)
    build_signoff_pdf(st)
    print(f"Wrote {REVIEW_PDF.name}")
    print(f"Wrote {SIGNOFF_PDF.name}")


if __name__ == "__main__":
    main()
