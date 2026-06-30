# UI Design Brief — எனக்கு (developer) தேவையானவை

நீங்க இந்த document-ல உள்ளதை design பண்ணி எனக்கு குடுத்தா, நான் அதை அப்படியே code-ஆ மாத்துவேன்.
எல்லாம் perfect-ஆ இருக்கணும்னு அவசியம் இல்ல — எவ்வளவு குடுக்கறீங்களோ அவ்வளவு accurate-ஆ build பண்ணுவேன்.

---

## A. முதல்ல: எந்த format-ல குடுக்கலாம் (இதுல ஏதாவது ஒண்ணு போதும்)

- ✅ **சிறந்தது:** Figma link (அல்லது Figma export)
- ✅ **நல்லது:** ஒவ்வொரு screen-ஓட **image / screenshot** (PNG/JPG)
- ✅ **OK:** காகிதத்துல வரைஞ்சு photo எடுத்தது (hand sketch)
- ✅ **OK:** வேற எந்த tool (Canva, PowerPoint, paint) export

> எந்த format-ஆ இருந்தாலும் பரவாயில்ல. முடிஞ்சா அளவுகள் (size) + colors சேர்த்து குடுங்க.

---

## B. எனக்கு தேவையான SCREENS (இந்த நிலைகளை வரையணும்)

இது single page app — ஆனா **4 நிலைகள் (states)** இருக்கு. முடிஞ்சா எல்லாத்துக்கும் ஒரு படம் குடுங்க:

| # | Screen / State | என்ன தெரியணும் |
|---|---|---|
| 1 | **Empty (முதல் screen)** | Form மட்டும், replies இன்னும் வரல |
| 2 | **Loading** | Generate அழுத்தினப்புறம் — replies வர்றதுக்கு முன் (spinner / skeleton) |
| 3 | **Results** | Replies cards-ஆ வந்துட்ட நிலை |
| 4 | **Error** | Key இல்ல / network problem-ல error message எப்படி தெரியணும் |

முடியலைனா — குறைஞ்சபட்சம் **#1 (Empty)** + **#3 (Results)** இரண்டு படம் போதும்.

மேலும் முடிஞ்சா: **Desktop** version + **Mobile (phone)** version — இரண்டுக்கும் தனித்தனி படம்.

---

## C. ஒவ்வொரு SCREEN-லயும் இந்த elements கட்டாயம் இருக்கணும்

இவை app வேலை செய்ய அவசியமானவை — design-ல எல்லாம் இடம்பெறணும்:

**1. Header**
- App title (பெயர்) + சிறிய tagline/விளக்கம்

**2. Input area**
- ☐ பெரிய **textarea** (message paste பண்ண) + label
- ☐ **Perspective** — 4 options: Supporter / Opposition / Neutral / All *(ஒண்ணு மட்டும் select)*
- ☐ **Reply styles** — 10 options: Funny, Professional, Friendly, Mass, Emotional, Savage, Smart, Debate, Short, Long *(பல select பண்ணலாம்)*
- ☐ **Output language** dropdown — Tamil / English / Tanglish
- ☐ **Number of replies** dropdown — 5 / 10 / 20
- ☐ **Generate** button

**3. Results area — Reply Card** (இது design-ல மிக முக்கியம்)
ஒவ்வொரு card-லயும்:
- ☐ Style பெயர் (tag/chip)
- ☐ Perspective (tag/chip)
- ☐ Reply text
- ☐ **Copy** button
- ☐ **Useful** (👍) button
- ☐ **Not useful** (👎) button

**4. Footer** (optional)
- சிறிய disclaimer text

---

## D. எனக்கு தேவையான DESIGN DETAILS (படத்தோட சேர்த்து குடுங்க)

இவை குடுத்தா, exact-ஆ அதே மாதிரி build பண்ணுவேன். இல்லைனா நான் ஊகிச்சு பண்ணுவேன்.

**1. Colors (hex codes-ஆ)**
- [ ] Background color
- [ ] Card / panel color
- [ ] Main text color
- [ ] Accent / button color (+ hover color)
- [ ] Border color
- [ ] "Useful" color (சாதாரணமா green)
- [ ] "Not useful" / error color (சாதாரணமா red)

**2. Fonts**
- [ ] English / UI font பெயர் (உதா: Inter, Poppins)
- [ ] Tamil font பெயர் (உதா: Noto Sans Tamil) — *Tamil தெளிவா தெரிய இது முக்கியம்*

**3. Shapes & spacing**
- [ ] Corner radius — கூர்மையா (sharp) இல்ல உருண்ட (rounded)?
- [ ] Buttons/chips எப்படி — round pills-ஆ, இல்ல சதுர boxes-ஆ?
- [ ] Shadow வேணுமா card-களுக்கு (இல்ல flat-ஆ)?

**4. Logo / icon**
- [ ] Logo image வேணுமா? இருந்தா PNG/SVG file குடுங்க
- [ ] இல்லைனா — text title மட்டும் போதுமா?

---

## E. சில முடிவுகள் (ஒரு வார்த்தையில் சொன்னா போதும்)

- [ ] **App பெயர்:** ____________________ (உதா: "AI Response Engine" / Tamil பெயர்)
- [ ] **Tagline:** ____________________
- [ ] **Dark mode** வேணுமா? (ஆம் / இல்ல)
- [ ] **Generate button** mobile-ல கீழ ஒட்டி (sticky) இருக்கணுமா? (ஆம் / இல்ல)

---

## F. குடுக்கும்போது சேர்த்து அனுப்புங்க (checklist)

- [ ] Screen படங்கள் (குறைஞ்சது Empty + Results)
- [ ] Colors list (hex)
- [ ] Font பெயர்கள்
- [ ] Logo file (இருந்தா)
- [ ] பெயர் + tagline
- [ ] Section E முடிவுகள்

---

> **சுருக்கம்:** படம் (Empty + Results) + colors + fonts — இந்த மூணு மட்டும் குடுத்தா கூட, நான் முழு app-ஐ அழகா build பண்ணிடுவேன். மீதி details இருந்தா இன்னும் accurate-ஆ வரும்.
