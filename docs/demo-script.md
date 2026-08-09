# Historical demo MP4 — corrected annotation, not final media

**File:** `output/arc-submission/ryntra-guard-arc-demo.mp4` — 1920×1080, H.264, 30 fps, **2:47**, 53 MB.
`output/` is gitignored, so the binary never enters the repository.

**Public URL exists:** https://ryntra.io/arc/video. The corrected source route is a withholding and
annotation notice: it must not render, download, or publish the historical MP4. The running
deployment SHA is unproven, so even that correction is not claimed live. Treat the URL as present,
not as a completed exact-candidate gate.

The existing render is **not the final candidate and must not be published or submitted**. In particular, scene 10's old caption, “All of
it public and MIT licensed,” is too broad: the public repository is an extraction, currently trails
the corrected private source, and must not imply that unrelated private product code is public. The
next separately authorized render must use the bounded annotation in the table below. Do not render,
mux, upload, or publish media in the current corrective session.

## What the historical file actually is

Twelve scenes, captured from the then-publicly reachable surface, Arcscan page, and GitHub
repository. They document the recorded run; they do not prove that today's corrected source is the
source currently deployed.

Captions are burned in and carry the whole argument, because that is how a judge with twenty
submissions and no headphones will watch it. They are rendered in the product's own typography
(Unbounded, Chakra Petch) by a browser pass rather than by `drawtext`, so there is no Arial seam.

## Why there is no narration track

Two reasons, in order:

1. A synthesized voice reading a founder's pitch risks creating a false impression about the
   presenter, which canon §22.16 forbids unless the programme's rules explicitly allow it. Those
   rules have not been verified.
2. The founder's own voice is strictly better for an accelerator, and the packet already recommends
   a founder video separately.

The scripts below are a **corrected annotation for a future authorized render**, not a verbatim
transcript of corrected media and not final-candidate evidence. A founder-recorded track could be
muxed only after separate authorization:

```bash
ffmpeg -i ryntra-guard-arc-demo.mp4 -i voiceover.wav -c:v copy -c:a aac -b:a 192k -shortest ryntra-guard-arc-demo-vo.mp4
```

## Corrected English annotation — not a final transcript

**01 — Title.** Hi, I'm Dmytro, founder of Ryntra. Ryntra Guard is a provider-neutral Decision and Settlement Evidence Layer for programmable money. This prototype is independent, Arc Testnet only, and not audited.

**02 — The gap.** A policy decision before signing does not prove what settled afterward. Applications need a durable link between the intended action, the evidence available at decision time, the policy result, the person's authorization, and the final onchain effect.

**03 — Separate states.** Ryntra keeps five independent states separate: evidence completeness, policy decision, authorization, execution, and reconciliation. An action allowed by policy is not automatically authorized. A confirmed transaction is not automatically reconciled.

**04 — Lifecycle.** The flow is intent, evidence, preflight, authorization, wallet execution, observation, and receipt. The user's own wallet remains the signer. Ryntra does not receive a private key or seed phrase.

**05 — Recorded run.** On Arc Public Testnet, the founder authorized one direct-EOA ERC-20 USDC transfer. Transaction `0x6476dc81…d5f9` succeeded in block `55677295` at `2026-08-06T22:19:23Z`. Expected and actual effects reconciled as `MATCHED`.

**06 — Expected versus actual.** The receipt preserves what the application expected and what the chain returned. In this run, the expected fee and actual fee differ, but the transfer amount and recipient match the authorized intent.

**07 — Explorer proof.** This is the same transaction on Arcscan. The explorer is independent evidence for the transaction hash, successful receipt, and block. One transaction proves only this recorded lifecycle; it is not a reliability claim.

**08 — Arc-specific finding.** Arc emitted the movement through both an 18-decimal native interface event and a 6-decimal ERC-20 event. Reconciliation selects the ERC-20 log for this transfer. Reading the wrong event would produce a twelve-order-of-magnitude error.

**09 — Integration surface.** The source includes a versioned API, an OpenAPI contract, and a private TypeScript integration client. The partner wallet signs and broadcasts; Ryntra records the decision and settlement evidence around it.

**10 — Public artifacts.** A public repository and reviewer artifacts exist. They must still be synchronized and verified against the exact reviewed candidate before final submission.

**11 — Limits.** This is testnet-only, not audited, and not production-ready. The App Kit swap has not completed end to end. The live Postgres test suite and repeat-run reliability remain unverified.

**12 — Close.** Arc settles the value. Ryntra preserves the evidence trail from intent to final effect, without taking control of the user's wallet.

## Повний український сценарій засновника

**01 — Назва.** Вітаю, я Дмитро, засновник Ryntra. Ryntra Guard — це нейтральний до провайдерів шар доказів рішення та розрахунку для програмованих грошей. Цей прототип є незалежним, працює лише з Arc Testnet і не проходив аудит безпеки.

**02 — Проблема.** Рішення політики до підпису не доводить, що саме відбулося після розрахунку. Застосунку потрібен стійкий зв'язок між наміром, доступними на момент рішення доказами, результатом політики, авторизацією людини та остаточним ончейн-ефектом.

**03 — Окремі стани.** Ryntra окремо зберігає повноту доказів, рішення політики, авторизацію, виконання та звірку. Дія, дозволена політикою, ще не є авторизованою. Підтверджена транзакція ще не є звіреною.

**04 — Життєвий цикл.** Послідовність така: намір, докази, попередня перевірка, авторизація, виконання через гаманець, спостереження та квитанція. Власний гаманець користувача залишається підписантом. Ryntra не отримує приватний ключ або seed phrase.

**05 — Зафіксований запуск.** В Arc Public Testnet засновник авторизував один прямий ERC-20 переказ USDC зі свого EOA-гаманця. Транзакція `0x6476dc81…d5f9` успішно увійшла до блока `55677295` о `2026-08-06T22:19:23Z`. Очікуваний і фактичний результати звірені зі статусом `MATCHED`.

**06 — Очікуване та фактичне.** Квитанція зберігає те, що очікував застосунок, і те, що повернув ланцюг. У цьому запуску очікувана та фактична комісії відрізняються, але сума переказу й одержувач відповідають авторизованому наміру.

**07 — Доказ у провіднику.** Це та сама транзакція в Arcscan. Провідник дає незалежні дані про хеш, успішний receipt і блок. Одна транзакція доводить лише цей зафіксований життєвий цикл, а не надійність повторних запусків.

**08 — Особливість Arc.** Arc відобразив один рух через подію 18-знакового native-інтерфейсу та подію 6-знакового ERC-20 інтерфейсу. Для цього переказу звірка бере ERC-20 лог. Вибір неправильної події дав би помилку на дванадцять порядків.

**09 — Інтеграційний контур.** У вихідному коді є версійований API, OpenAPI-контракт і приватний TypeScript-клієнт для інтеграції. Гаманець партнера підписує та транслює транзакцію, а Ryntra зберігає докази рішення й розрахунку навколо неї.

**10 — Публічні артефакти.** Публічний репозиторій і матеріали для рев'ю існують. Перед фінальною подачею їх ще потрібно синхронізувати та перевірити саме проти точного кандидата, який пройшов рев'ю.

**11 — Обмеження.** Це лише testnet-прототип, без аудиту і без готовності до production. App Kit swap не пройшов повний цикл. Live-тести Postgres і надійність повторних запусків також не підтверджені.

**12 — Завершення.** Arc виконує розрахунок, а Ryntra зберігає доказовий шлях від наміру до фінального ефекту, не перебираючи контроль над гаманцем користувача.

## Scene list

| # | Frame source | Sec | Caption |
|---:|---|---:|---|
| 1 | `/arc/deck` title | 8 | — (the slide is the title) |
| 2 | `/arc/deck` 02 | 16 | A decision taken before you sign does not prove what settled. |
| 3 | `/arc/deck` 03 | 18 | Five axes, kept separate: evidence, policy, authorization, execution and reconciliation. Allowed is not authorized. Confirmed is not reconciled. |
| 4 | `/arc/deck` 04 | 16 | Seven steps — and your own wallet stays the signer throughout. |
| 5 | `/arc` | 12 | This reviewer surface is public. Exact-candidate deployment parity still has to be verified. |
| 6 | `/arc/deck` 05 | 18 | Expected fee 0.001548973026 → actual 0.001530838950 USDC, read back from the chain. MATCHED. |
| 7 | **Arcscan** | 20 | The same transaction on Arcscan. Block 55677295. Status success. |
| 8 | `/arc/deck` 06 | 24 | Arc emitted one movement as two Transfer events. Read the wrong one and you are wrong by 10¹². |
| 9 | `/arc/deck` 07 | 12 | Ten HTTP operations across nine versioned route paths. An OpenAPI contract. A client that never touches a key. |
| 10 | **GitHub** | 10 | A public MIT extraction exists. Exact-candidate synchronization remains. |
| 11 | `/arc/deck` 08 | 10 | Testnet only. Not audited. The historical record covers one exact transfer; it does not prove current deployment parity or reliability. |
| 12 | `/arc/deck` 09 | 10 | Arc settles value. Ryntra preserves the decision that led to it. |

Scene 7 is framed so the explorer's own `Transaction fee 0.00153083895 USDC` row sits **above** the
caption. That number is what reconciliation compared against, so it has to be readable — the first
cut buried it under the caption scrim.

Scene 8 is the centre of gravity. It shows a hazard written into the Arc pack as
`ARC_EVENT_DOUBLE_COUNT_RISK` *before* the run and confirmed on a real transaction, which is the
difference between having read Arc's documentation and having settled value on Arc.

## What the video deliberately does not show

A live wallet-signing sequence. The recorded run already happened, signed by the founder in their
own wallet; re-staging it for a camera would mean either a second real transaction or a simulated
one, and a simulated signing in a video about settlement evidence is exactly the thing this product
argues against. The video shows the artifacts instead — the reconciled receipt, the explorer page,
the public source — all of which a reviewer can verify without trusting the recording.

## Reproducing it

Everything needed is in `output/arc-submission/`, and the pipeline reads the live site, so
re-running it after a deploy produces a video of the current surface:

```bash
node capture.mjs          # 13 frames, 1440x810 @2x, from the deployed URLs
node compose-scenes.mjs   # burns captions in the product's own type
node render.mjs           # per-scene segments, then the crossfade pass
```

Requires `playwright` with Chromium, and `ffmpeg` on PATH.

## Verify before final submission

1. The transaction hash in scene 7 matches the Arcscan page it was captured from.
2. Scene 6's expected and actual fees match `RECORDED_RUN` in `app/arc/arc-project.ts`.
3. No caption contains `first`, `only`, `guaranteed`, `institutional-grade`, `production-ready` or
   an Arc/Circle partnership claim.
4. Duration is under three minutes.
5. A newly authorized video, its final transcript, repository, deck, demo, and reviewer page all resolve logged out to the exact reviewed candidate. The corrected annotation in this file is not that final media.

## Thirty-second founder video — Accelerator recommendation

Still recommended, still not required for the submission itself:

> "Hi, I'm Dmytro, founder of Ryntra. Programmable-money apps already use wallets, security, policy,
> compliance and settlement providers, but decision and settlement evidence is still fragmented.
> Ryntra Guard is a provider-neutral layer that links one intent, attributed evidence, versioned
> policy, human authorization and the final onchain effect. Our Arc Testnet prototype keeps the
> user's wallet in control and produces an expected-versus-actual receipt. We're turning this into a
> practical integration product for payment, treasury and tokenized-market applications."

Українська версія для підготовки засновника:

> «Вітаю, я Дмитро, засновник Ryntra. Застосунки для програмованих грошей уже поєднують гаманці, безпекові, політичні, комплаєнс- і розрахункові сервіси, але докази рішення та фактичного розрахунку залишаються розрізненими. Ryntra Guard пов'язує один намір, атрибутовані докази, версію політики, авторизацію людини та фінальний ончейн-ефект. Наш Arc Testnet прототип залишає контроль у гаманця користувача та формує квитанцію зі звіркою очікуваного й фактичного. Ми перетворюємо цей підхід на практичний інтеграційний продукт для платіжних, казначейських і токенізованих застосунків».
