# Generates the fictional sample faxes used by the Fax Inbox demo
# ("Load a sample fax"). Every name, ID and number is invented.
#   python3 scripts/sample-faxes/make-samples.py   (needs: pip install reportlab)
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.units import inch
import os

OUT = os.path.dirname(os.path.abspath(__file__))

def header(c, sender, fax, when, page, total):
    c.setFont("Courier", 8.5)
    c.drawString(0.5 * inch, 10.75 * inch, f"{when}   FROM: {sender}   FAX {fax}   TO: 5125550199   P.{page:03d}/{total:03d}")
    c.line(0.5 * inch, 10.7 * inch, 8 * inch, 10.7 * inch)

def lines(c, x, y, rows, font="Helvetica", size=10.5, lead=15):
    for r in rows:
        if isinstance(r, tuple):
            c.setFont("Helvetica-Bold", size); c.drawString(x, y, r[0])
            c.setFont(font, size); c.drawString(x + 2.1 * inch, y, r[1])
        else:
            c.setFont(font, size); c.drawString(x, y, r)
        y -= lead
    return y

def molina():
    c = canvas.Canvas(os.path.join(OUT, "molina-authorization-rosa-delgado.pdf"), pagesize=letter)
    header(c, "MOLINA HEALTHCARE OF TEXAS", "8665550142", "09/25/2026 10:14", 1, 2)
    c.setFont("Helvetica-Bold", 18); c.drawString(0.8 * inch, 10.1 * inch, "Molina Healthcare of Texas")
    c.setFont("Helvetica", 9); c.drawString(0.8 * inch, 9.9 * inch, "Care Coordination  ·  1660 Westridge Circle North, Irving, TX 75038")
    c.setFont("Helvetica-Bold", 13); c.drawString(0.8 * inch, 9.45 * inch, "FAX COVER SHEET")
    lines(c, 0.8 * inch, 9.1 * inch, [
        ("To:", "Hearth Home Care (Demo) - Intake"),
        ("From:", "Dana Whitaker, RN - Service Coordinator"),
        ("Date:", "09/25/2026"),
        ("Re:", "Service Authorization - Personal Attendant Services"),
        ("Pages:", "2 including cover"),
    ])
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(0.8 * inch, 1 * inch, "CONFIDENTIAL: This fax contains protected health information. If received in error, notify the sender and destroy it.")
    c.showPage()
    header(c, "MOLINA HEALTHCARE OF TEXAS", "8665550142", "09/25/2026 10:14", 2, 2)
    c.setFont("Helvetica-Bold", 14); c.drawString(0.8 * inch, 10.1 * inch, "SERVICE AUTHORIZATION NOTIFICATION")
    y = lines(c, 0.8 * inch, 9.6 * inch, [
        ("Member Name:", "Rosa M. Delgado"),
        ("Date of Birth:", "03/08/1944"),
        ("Medicaid ID:", "520 481 736"),
        ("Member Address:", "4127 Pecan Hollow Dr, San Antonio, TX 78223"),
        ("Member Phone:", "(210) 555-0183"),
        ("Plan:", "Molina STAR+PLUS"),
        ("Authorization #:", "MOL-PAS-2026-77310"),
        ("Service:", "Personal Attendant Services (PAS)"),
        ("Procedure Code:", "S5125 U5"),
        ("Authorized Hours:", "18 hours per week"),
        ("Effective Dates:", "10/01/2026 - 03/31/2027"),
        ("Diagnosis:", "Parkinson's disease; assistance with ADLs and mobility"),
    ])
    lines(c, 0.8 * inch, y - 10, [
        "Approved tasks: bathing, dressing, grooming, meal preparation, light housekeeping,",
        "escort to medical appointments. Please contact the member within 2 business days to",
        "schedule the initial visit and complete the attendant orientation.",
        "",
        "Service Coordinator: Dana Whitaker, RN   Phone: (866) 555-0142 ext 4417",
    ], size=10)
    c.showPage(); c.save()

def superior():
    c = canvas.Canvas(os.path.join(OUT, "superior-referral-lionel-brooks.pdf"), pagesize=letter)
    header(c, "SUPERIOR HEALTHPLAN", "8005550177", "09/25/2026 14:02", 1, 1)
    c.setFont("Helvetica-Bold", 16); c.drawString(0.8 * inch, 10.1 * inch, "Superior HealthPlan - Community Referral")
    c.setFont("Helvetica", 9); c.drawString(0.8 * inch, 9.88 * inch, "5900 E. Ben White Blvd, Austin, TX 78741  ·  LTSS Department")
    c.rect(0.8 * inch, 6.4 * inch, 6.9 * inch, 3.2 * inch)
    lines(c, 1.0 * inch, 9.35 * inch, [
        ("Patient:", "BROOKS, LIONEL J"),
        ("DOB:", "11/19/1951"),
        ("Member ID (Medicaid):", "618-203-554"),
        ("Address:", "88 Magnolia St Apt 4B, Austin, TX 78702"),
        ("Referral / Auth No.:", "SHP-2026-0930-4471"),
        ("Program / Service:", "STAR+PLUS HCBS - Personal Attendant Services"),
        ("Units:", "12 hrs/wk"),
        ("Start - End:", "10/05/2026 to 04/04/2027"),
        ("Primary Dx:", "CHF, COPD - needs help with bathing and meals"),
    ], size=10.5, lead=17)
    lines(c, 0.8 * inch, 6.0 * inch, [
        "Referring coordinator: M. Okafor, LVN   (800) 555-0177 x220",
        "Please confirm acceptance of this referral by return fax.",
    ], size=10)
    c.showPage(); c.save()

def hospital():
    c = canvas.Canvas(os.path.join(OUT, "hospital-discharge-incomplete.pdf"), pagesize=letter)
    header(c, "ST. DAVID'S MEDICAL CTR", "5125550644", "09/25/2026 16:40", 1, 1)
    c.setFont("Helvetica-Bold", 15); c.drawString(0.8 * inch, 10.1 * inch, "Discharge Planning - Home Care Referral")
    lines(c, 0.8 * inch, 9.6 * inch, [
        ("Patient name:", "Gloria Tran"),
        ("DOB:", "7/2/1938"),
        ("Insurance:", "Amerigroup STAR+PLUS (Medicaid ID pending)"),
        ("Services requested:", "Personal care / homemaker after discharge"),
        ("Hours:", "TBD by health plan"),
        ("Diagnosis:", "Hip fracture s/p ORIF; fall risk"),
        ("Discharge date:", "09/27/2026"),
    ])
    lines(c, 0.8 * inch, 7.6 * inch, [
        "Case manager: R. Villanueva, LMSW  (512) 555-0644",
        "Authorization will follow from the health plan.",
    ], size=10)
    c.showPage(); c.save()

molina(); superior(); hospital()
print("wrote sample faxes to", OUT)
