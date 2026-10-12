# SthapnaCorp growth plan

Written 12 October 2026. The site now has three ways to turn visitors into paying clients:

1. **WhatsApp buttons** on every page, with the message already filled in.
2. **The enquiry form**, which lands in Admin → Enquiries and emails you straight away.
3. **The free reminder list.** Every reminder email has an "Ask us to file these" button, and you get a daily digest of who was reminded, so you can follow up.

The plan below gets traffic onto those three.

---

## 1. Go-live checklist (do this first, about 30 minutes)

### Vercel → Project → Settings → Environment Variables

| Name | Value | Notes |
|---|---|---|
| `DATABASE_URL` | already set | Railway Postgres. New tables are created automatically on first use. |
| `ADMIN_PASSWORD` | a new strong password | **Required.** The old password `Welcome@3` was visible in the public `admin.html` and no longer works. |
| `SMTP_USER` | `sthapnacorp@gmail.com` | The account that sends lead alerts and reminders. |
| `SMTP_PASS` | a Gmail **app password** | Google Account → Security → 2-Step Verification (turn on) → App passwords. Not your normal password. |
| `NOTIFY_EMAIL` | optional | Where new-lead alerts go. Defaults to `SMTP_USER`. |
| `CRON_SECRET` | any long random string | Vercel sends it to the daily reminder job so nobody else can trigger it. |
| `SITE_URL` | `https://sthapnacorp.com` | Used in unsubscribe links. |

Redeploy after saving. Then:

- [ ] Open `/admin`, sign in with the new password, and check all three tabs load.
- [ ] Send yourself a test enquiry from the homepage. You should get an email within a minute.
- [ ] Subscribe yourself to reminders from the calendar section. You should get a confirmation email.
- [ ] In Admin → Reminder subscribers, click **Send due reminders now** once to check the reminder email.
- [ ] Confirm the prices on the homepage and service pages (see section 7).
- [ ] Read and adjust `/terms`, `/privacy` and `/refund`. Razorpay asks for these during live-mode KYC.
- [ ] Switch Razorpay from the test key to the live key in `incorporate.html` once KYC is approved.

Gmail allows about 500 emails a day, which is enough for the first few hundred subscribers. Move to a transactional email service when the list grows past that.

---

## 2. This month: the October deadline campaign

AOC-4 and LLP Form 8 are due **30 October**, ITR-6 and MSME-1 on **31 October**, and MGT-7 on **29 November**. Businesses are searching for help right now.

### WhatsApp broadcast (send to your own saved contacts only)

> Hi {name}, a quick reminder: AOC-4 for FY 2025-26 is due by 30 October and MGT-7 by 29 November. After that, MCA charges ₹100 a day for each form, with no upper limit. If you'd like us to handle the board's report, AGM documents and both filings for a fixed fee, just reply "Yes" and I'll send a quote today.
> You can also check every due date for your company here: https://sthapnacorp.com/#calendar

LLP version:

> Hi {name}, LLP Form 8 for FY 2025-26 is due on 30 October. Late filing costs ₹100 a day. We file Form 8 and Form 11 from ₹4,999. Reply "Yes" for a quote.

WhatsApp only allows broadcasts to people who have saved your number. Don't message lists of strangers: it gets the number banned.

### LinkedIn post

> 18 days to the AOC-4 deadline.
>
> If your company held its AGM on 30 September, AOC-4 is due on 30 October and MGT-7 on 29 November. Every late day costs ₹100 per form, and there's no cap. The CCFS-2026 relief window has closed, so there's no discount this year.
>
> Three things worth checking:
> 1. "No revenue" doesn't mean "no filing". AOC-4 and MGT-7 are due even for a company with no business.
> 2. Directors' KYC is now due once every three years, by 30 June, not every September.
> 3. Small companies and OPCs file the shorter MGT-7A, not MGT-7.
>
> I built a free calendar that lists every due date for your company and emails you before each one: https://sthapnacorp.com/#calendar
>
> #ROCcompliance #startupindia #companysecretary #Hyderabad

### Late-fee post (for owners who are already behind)

> Check what a missed filing is costing you: https://sthapnacorp.com/#late-fee
> A company that hasn't filed AOC-4 and MGT-7 for FY 2023-24 owes about ₹1.39 lakh in additional fees for that year alone, as of today, and ₹200 more every day.

---

## 3. Google Business Profile (free, highest return for "near me" searches)

1. Create the profile at business.google.com as **SthapnaCorp**.
2. Primary category: **Tax consultant**. Additional categories: **Business management consultant**, **Legal services**.
3. If clients don't visit an office, set it up as a **service-area business**: hide the address, and add Hyderabad, Secunderabad, Cyberabad and Telangana as the service area.
4. Website: `https://sthapnacorp.com/?utm_source=google&utm_medium=gbp`. Phone: +91 89192 32657. Hours: Mon–Sat 9–7.
5. Description (under 750 characters):

> SthapnaCorp handles company law and compliance for private limited companies, LLPs and OPCs: company and LLP registration, annual ROC filings (AOC-4, MGT-7, LLP Form 8 and 11), director and share capital changes, FEMA reporting (FC-GPR, FC-TRS), private company demat, overdue filings and company closure (STK-2). We also prepare ITR-2 for NRIs and ESOP holders and reply to income-tax notices. Fixed professional fees quoted upfront; government fees at actuals. Based in Hyderabad, filing for clients across India.

6. Add each service with its price from the website.
7. Ask every client you have finished work for to leave a review. Reviews drive local ranking more than anything else.
8. Post an update every week. Use the deadline posts above.

---

## 4. Google Ads

**Budget:** start at ₹500–800 a day, only while deadlines are close (now to 30 November), then keep one always-on campaign for overdue filings and closures.

**Before spending:** put your Google Analytics 4 measurement ID and Google Ads conversion ID and label in `assets/site.js` (the `CONFIG` block at the top). The site then records a conversion for every enquiry, reminder sign-up and WhatsApp click.

**Settings:** Search network only (no Display), location "Presence: people in or regularly in" India. For the registration campaign, target Hyderabad and Telangana only. Bidding: Maximise conversions once you have 15 or more conversions; until then, Maximise clicks with a ₹40 CPC cap.

Use `?utm_source=google&utm_medium=cpc&utm_campaign=<name>` on every final URL. Admin → Enquiries shows the campaign each lead came from.

### Campaign A: Deadline (run until 29 Nov)

Final URL: `https://sthapnacorp.com/services/private-limited-annual-compliance`

Keywords (phrase match): "aoc 4 filing", "mgt 7 filing", "roc annual filing", "annual compliance private limited company", "aoc 4 due date", "mgt 7a filing", "roc filing consultant"

Headlines:
- File AOC-4 Before 30 Oct
- AOC-4 & MGT-7 Filing
- Fixed Fee From ₹9,999
- CA/CS-Reviewed ROC Filing
- Avoid ₹100/Day Late Fees
- Board Report + AGM Docs
- Quote in One Working Day
- Hyderabad · All India
- MGT-7A for Small Companies
- Filed Same Day, SRN Shared

Descriptions:
- AOC-4 is due 30 Oct. Every late day costs ₹100 per form. Get it filed by professionals.
- Board report, AGM notice, AOC-4 and MGT-7 prepared and filed. Fixed fee, no surprises.
- Send your audited financials today. We draft, you sign, we file and share the SRN.
- Free compliance calendar and email reminders for every due date of your company.

### Campaign B: LLP Form 8 (run until 30 Oct)

Final URL: `https://sthapnacorp.com/services/llp-annual-compliance`

Keywords: "llp form 8 filing", "llp annual filing", "form 8 llp due date", "llp form 11 filing", "llp compliance"

Headlines: LLP Form 8 Due 30 October · LLP Annual Filing ₹4,999 · Form 8 & Form 11 Filing · ₹100/Day Late Fee Per Form · CA/CS-Reviewed Filing · Quote in One Working Day · File Pending LLP Returns

Descriptions:
- Form 8 is due 30 Oct. Late filing costs ₹100 a day per form, with no upper limit.
- Form 8 and Form 11 prepared, certified and filed for a fixed fee. WhatsApp us now.
- Missed earlier years? We clear LLP backlogs year by year with a written estimate.

### Campaign C: Overdue filings and closure (always on)

Final URLs: `/services/overdue-roc-filings` and `/services/close-company-strike-off`

Keywords: "roc late fee", "pending roc filing", "director disqualification 164", "din deactivated", "close private limited company", "strike off company", "stk 2 filing", "llp closure"

Headlines: Overdue ROC Filings? · Clear AOC-4 & MGT-7 Backlog · Stop the ₹100/Day Late Fee · Protect Directors' DINs · Free Late Fee Calculator · Close Your Pvt Ltd Company · STK-2 Strike Off ₹14,999 · Close It or Catch Up?

Descriptions:
- Three years unfiled disqualifies every director. Clear the backlog before it is too late.
- See your exact MCA late fee in seconds, then get a fixed quote to file or close.
- Inactive company still costs you every year. Strike it off properly with STK-2.

### Campaign D: Company registration, Hyderabad

Final URL: `https://sthapnacorp.com/services/company-registration-hyderabad`

Keywords: "company registration hyderabad", "private limited company registration hyderabad", "llp registration hyderabad", "opc registration", "register company telangana"

Headlines: Company Registration Hyderabad · Private Limited in ₹10,000 · LLP Registration ₹7,000 · Apply Online Today · Name Check Before You File · NOC & Rent Deed Drafted · Help After Incorporation

Descriptions:
- Private limited, LLP or OPC registered online. Fixed professional fee plus govt fees.
- We check names, draft the office NOC and file SPICe+. Annual compliance support after.

### Negative keywords (all campaigns)

free, govt website, mca login, mca portal, job, jobs, vacancy, salary, course, syllabus, pdf, format download, icsi, exam, internship, meaning, wikipedia

---

## 5. Search engines (free, slower)

1. Add `sthapnacorp.com` to Google Search Console (verify through GoDaddy DNS) and submit `https://sthapnacorp.com/sitemap.xml`.
2. Do the same in Bing Webmaster Tools.
3. Each service page targets one search intent. Add one new guide a month. Good next topics:
   - "MGT-7 vs MGT-7A: which one does your company file?"
   - "DIR-3 KYC is now every three years: who files in 2027?"
   - "How to close a private limited company in 2026"
   - "FC-GPR late submission fee explained"
4. Update the dates on `/guides/compliance-calendar-2026-27` whenever MCA or CBDT extends a deadline. Fresh, accurate dates are what make it rank.

---

## 6. Finding clients from public data

Newly incorporated companies are the best prospects. They must file INC-20A within 180 days, appoint a first auditor within 30 days, and nobody has told them about AOC-4 yet.

- **data.gov.in** has published state-wise company master data (CIN, name, date of registration, status, registered office). Filter for Telangana companies registered in the last six months.
- **MCA's "View company or LLP master data"** shows details for one company at a time.

How to use it without getting into trouble:

- Write to the company's registered business address or registered email, once, with something useful (for example, "your INC-20A is due by {date}"), and a clear way to opt out.
- Don't add these contacts to WhatsApp broadcasts. WhatsApp's policy requires the person's opt-in, and numbers get banned for it.
- Don't cold-call numbers on the DND registry.
- Keep the list only as long as it's useful, as required by the Digital Personal Data Protection Act, 2023.

I didn't build an automatic scraper for MCA. Its terms of use don't allow bulk extraction, and mass messaging carries the risks above. If you download a dataset, it can be imported into the admin as leads.

---

## 7. Prices to confirm before going live

The incorporation and name-reservation fees come from your existing funnel. **All other prices are my proposals**, set around the middle of what online providers charge in 2026. Change them in `index.html` (Services and Retainers sections) and in the matching service page in `services/`.

| Service | Proposed fee |
|---|---|
| Annual ROC filing, private company or OPC | from ₹9,999 a year |
| LLP annual filing | from ₹4,999 a year |
| MSME-1 or DPT-3 | ₹1,499 per return |
| DIR-3 KYC | ₹499 per director |
| Director change | ₹2,999 |
| Increase in authorised capital | ₹3,999 |
| Share allotment or transfer | from ₹4,999 |
| Name change, office shift, conversion, LLP partner change | from ₹3,999 |
| FC-GPR or FC-TRS | ₹9,999 per filing |
| CCPS or CCD issue | from ₹14,999 |
| ISIN and demat | from ₹14,999 |
| Overdue filings | from ₹2,999 per form per year |
| Strike-off (STK-2) | ₹14,999 + ₹10,000 MCA fee |
| LLP closure | from ₹9,999 |
| ITR-2 (NRI, foreign assets, ESOP) | from ₹3,999 |
| Tax notice reply | from ₹4,999 |
| Trademark application | ₹4,999 + government fee |
| LLP agreement or partnership deed | ₹2,999 |
| Retainers: Essentials / Growth / Complete | ₹11,999 / ₹24,999 / ₹39,999 a year |

---

## 8. Every Monday, ten minutes

- Admin → Enquiries: call every lead still marked **New**, then set it to Contacted, Quoted, Won or Lost.
- Read the daily "Reminders sent today" emails from the past week and WhatsApp anyone with a deadline under seven days.
- Check Google Ads cost per enquiry. Pause any campaign above ₹800 per enquiry after two weeks.
