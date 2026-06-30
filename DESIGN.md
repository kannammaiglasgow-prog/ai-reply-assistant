# AI Response Engine — UI Design Document

**Direction chosen:** Clean Light / Minimal
**Goal:** Simple, professional, easy to read. Works well on phone and desktop. No clutter.

> இந்த document-ஐ review பண்ணுங்க. மாத்தணும்னு நினைச்சதை குறிச்சு சொல்லுங்க — அப்புறம் நான் இதை அப்படியே code-ல build பண்றேன்.

---

## 1. Design principles (வழிகாட்டும் கொள்கைகள்)

1. **Calm & clean** — வெள்ளை background, நிறைய white space, ஒரே ஒரு accent color.
2. **Content first** — message box-உம் generated replies-உம் தான் முக்கியம்; controls அமைதியா background-ல இருக்கும்.
3. **Readable** — Tamil + English + Tanglish மூணும் தெளிவா படிக்கணும். நல்ல Tamil font, போதுமான font size.
4. **One screen, no jumps** — single page. Generate பண்ணா replies கீழே வரும், page reload இல்ல.
5. **Mobile-first** — phone-ல ஒரு column; desktop-ல controls + results அழகா விரியும்.

---

## 2. Color palette

| Role | Color | Hex | எங்க பயன்படுது |
| --- | --- | --- | --- |
| Page background | Soft off-white | `#F7F8FA` | முழு page |
| Card / panel | Pure white | `#FFFFFF` | input panel, reply cards |
| Border / divider | Light grey | `#E3E6EC` | card outlines, separators |
| Primary text | Near-black | `#1A1D24` | headings, reply text |
| Muted text | Grey | `#6B7280` | labels, hints, footer |
| **Accent (primary)** | Indigo | `#4F46E5` | Generate button, active states, links |
| Accent hover | Darker indigo | `#4338CA` | button hover |
| Success | Green | `#16A34A` | "Useful" active, copied |
| Danger / negative | Soft red | `#DC2626` | "Not useful" active, errors |
| Accent tint | Very light indigo | `#EEF0FE` | selected chips background |

**ஏன் இந்த colors:** ஒரே ஒரு bold color (indigo) மட்டும் — மீதி எல்லாம் grey/white. இதனால screen busy-ஆ தெரியாது, professional-ஆ இருக்கும்.

---

## 3. Typography (fonts)

- **UI + English text:** `Inter` (அல்லது system font fallback) — modern, படிக்க எளிது.
- **Tamil text:** `Noto Sans Tamil` — Google font, இலவசம், Tamil-க்கு தெளிவானது.
- Headings: 600–700 weight. Body: 400. Labels: 500.

| Element | Size | Weight |
| --- | --- | --- |
| App title (H1) | 26–30px | 700 |
| Section labels | 14px | 600 |
| Body / reply text | 16px | 400 |
| Hints / footer | 13px | 400 |
| Buttons | 15px | 600 |

---

## 4. Layout / Wireframe

### Desktop (இரண்டு column உணர்வு)

```
┌───────────────────────────────────────────────────────────┐
│                    AI Response Engine                       │
│        Paste anything. Get reply ideas instantly.           │
├───────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Your message / article / comment                    │  │
│  │  ┌─────────────────────────────────────────────────┐ │  │
│  │  │  [ large textarea ]                             │ │  │
│  │  │                                                 │ │  │
│  │  └─────────────────────────────────────────────────┘ │  │
│  │                                                       │  │
│  │  Perspective:  (○ Supporter ○ Opposition            │  │
│  │                 ○ Neutral  ● All)   ← pill buttons   │  │
│  │                                                       │  │
│  │  Reply styles:  [Funny][Professional][Friendly]...   │  │
│  │                 ← toggle chips, multi-select         │  │
│  │                                                       │  │
│  │  Language [English ▾]   Replies [5 ▾]                │  │
│  │                                                       │  │
│  │            [   ✦  Generate replies   ]  ← full width │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│   5 replies generated                                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ [Funny][All] │ │ [Smart][Sup] │ │ [Mass][Opp]  │        │
│  │ reply text...│ │ reply text...│ │ reply text...│        │
│  │              │ │              │ │              │        │
│  │ Copy 👍 👎    │ │ Copy 👍 👎    │ │ Copy 👍 👎    │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
└───────────────────────────────────────────────────────────┘
```

### Mobile (ஒரு column)

- எல்லாம் ஒரே column-ல adjust ஆகும்.
- Style chips 2 per row-ஆ wrap ஆகும்.
- Reply cards ஒன்றுக்கு கீழே ஒன்றா stack ஆகும்.
- Generate button full-width, கீழே ஒட்டிக்கிட்டு (sticky) இருக்கலாம் — easy-ஆ அழுத்த.

---

## 5. Components (ஒவ்வொண்ணும் எப்படி இருக்கும்)

### a) Message textarea
- White, rounded corners (12px), light grey border.
- Focus பண்ணும்போது border indigo-ஆ மாறும்.
- கீழே வலது மூலையில் சிறிய character count (உதா: `0 / 8000`).

### b) Perspective — **pill/segmented buttons** (radio-க்கு பதிலா)
- 4 options ஒரே வரிசையில். தேர்ந்தெடுத்தது indigo fill + வெள்ளை text.
- மற்றவை வெள்ளை + grey border.
- (Radio circles விட இது cleaner-ஆ தெரியும்.)

### c) Reply styles — **toggle chips** (checkbox-க்கு பதிலா)
- 10 chips, wrap ஆகும். தேர்ந்தெடுத்தது light indigo background (`#EEF0FE`) + indigo border + ✓.
- தேர்வு செய்யாதது வெள்ளை + grey.
- மேல சின்ன "Select all / Clear" link (optional).

### d) Language & Count — dropdowns
- சாதாரண clean select boxes, ஒரே வரிசையில் பக்கம் பக்கமா.

### e) Generate button
- Full-width, indigo, rounded (12px), 600 weight.
- ✦ icon + "Generate replies".
- Loading-ல: spinner + "Generating…", button disabled.

### f) Reply card
- White card, light border, rounded (14px), மென்மையான shadow.
- **மேல:** 2 tags — Style (indigo tint chip) + Perspective (green tint chip).
- **நடு:** reply text (16px, படிக்க எளிது).
- **கீழ:** 3 buttons — `Copy`, `👍 Useful`, `👎 Not useful`.
  - Copy அழுத்தினா → "Copied ✓" (2 விநாடி).
  - Useful active → green tint. Not useful active → red tint. (இரண்டுல ஒண்ணு மட்டும்.)

### g) States
- **Empty (முதல்ல):** results பகுதி காலி; சின்ன hint — "Your replies will appear here."
- **Loading:** 3–6 skeleton cards (மெல்ல shimmer).
- **Error:** card பகுதிக்கு மேல சிவப்பு text-ல தெளிவான message.
- **Success:** "{n} replies generated" + cards.

---

## 6. Spacing & shape (consistency-க்காக)

- Corner radius: inputs/buttons 12px, cards 14px, chips 999px (முழு round).
- Card-களுக்கு இடையே gap: 14px.
- Panel padding: desktop 24px, mobile 16px.
- Max content width: 900px, நடுவில் center.

---

## 7. Accessibility (அணுகல்தன்மை)

- Text vs background contrast WCAG AA pass ஆகும் (dark text on white).
- எல்லா button/chip-க்கும் keyboard focus outline (indigo).
- Touch targets குறைஞ்சது 40px உயரம் — phone-ல easy tap.
- Screen reader-க்கு proper labels (`aria-label`).

---

## 8. நீங்க முடிவு செய்ய வேண்டியவை (open questions)

1. **App பெயர் / tagline** — "AI Response Engine" அப்படியே வச்சிக்கலாமா, அல்லது Tamil பெயர் வேணுமா?
2. **Logo / icon** — மேல சின்ன logo வேணுமா, இல்ல வெறும் text title போதுமா?
3. **Accent color** — indigo (`#4F46E5`) OK-வா, இல்ல வேற color (உதா: teal, blue, orange)?
4. **Perspective/Style** — pill/chip design OK-வா, இல்ல சாதாரண radio/checkbox-ஐ வச்சிக்கணுமா?
5. **Generate button** mobile-ல sticky (கீழ ஒட்டி) வேணுமா, இல்ல normal-ஆ flow-ல இருந்தா போதுமா?
6. **Dark mode toggle** — light-ஓட சேர்த்து dark mode switch-உம் வேணுமா? (optional)

---

*இந்த design-ஐ approve பண்ணா, அல்லது மாத்தல் சொன்னா — நான் முழு UI-ஐ இந்த spec-படி build பண்றேன்.*
