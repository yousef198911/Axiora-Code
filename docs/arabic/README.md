# التعريب الكامل ودعم العربية — Axiora-Code

| # | الصورة | الوصف |
|---|---|---|
| 01 | ./shots/ar-01-settings-language-en.png | القسم رقم 12 «Language / اللغة» في الإعدادات بالواجهة الإنجليزية: لغة العرض (English افتراضياً)، والتخطيط من اليمين لليسار للعربية، وزر اللغة في شريط الحالة (🌐 EN أسفل اليمين)، ولغة رد الذكاء الاصطناعي، ولغة الإملاء الصوتي. |
| 02 | ./shots/ar-02-switch-picker-en.png | أمر «Axiora: Switch Display Language» من لوحة الأوامر: اختيار English أو العربية، مع توضيح الاتجاه (من اليسار لليمين / من اليمين لليسار). |
| 03 | ./shots/ar-03-restart-dialog-en.png | بعد اختيار العربية: يطلب التطبيق إعادة التشغيل للتحويل إلى العربية (آلية Code-OSS الأصلية: تُكتب اللغة في argv.json ثم يُعاد التشغيل). |
| 04 | ./shots/ar-04-workbench-rtl.png | الواجهة كاملة بالعربية بعد التحويل: القوائم والعناوين وصفحة الترحيب بالعربية، والتخطيط معكوس (شريط الأنشطة والمستكشف على اليمين، والمحادثة على اليسار)، وزر اللغة «ع» في شريط الحالة. |
| 05 | ./shots/ar-05-settings-language-ar.png | الإعدادات بالعربية والتخطيط معكوس: قسم «اللغة» → «لغة العرض» مضبوطة على العربية، و«تخطيط من اليمين لليسار للعربية»، و«زر تبديل اللغة في شريط الحالة». الأوصاف كلها بالعربية وتوضح أن الكود والمعرّفات ومحتوى الملفات لا تُترجم أبداً. |
| 06 | ./shots/ar-06-command-palette-ar.png | لوحة الأوامر بالعربية: أوامر Axiora مترجمة مع بقاء الاسم الإنجليزي تحته للبحث، وأمر «Axiora: تبديل لغة العرض (English / العربية)» في الأعلى؛ ولوحة المحادثة على اليسار بالعربية («إنشاء مع المعالجات»، «وصف ما يجب إنشاؤه بعد ذلك»). |
| 07 | ./shots/ar-07-auto-switch.png | التبديل التلقائي: بعد اختيار «العربية» من لوحة الأوامر أُعيد تشغيل التطبيق تلقائياً دون أي نافذة تأكيد، وعاد بالعربية ومن اليمين لليسار مع نفس المجلد والنوافذ. |
| 07d | ./shots/ar-07d-auto-switch-back-en.png | الاتجاه المعاكس: من العربية إلى English تلقائياً دون تأكيد، مع استعادة الملف a.js وتعديله غير المحفوظ («// unsaved edit kept» والنقطة على التبويب). |

## RTL coverage / حدود الانعكاس
- Mirrored: activity bar, side bar (right), panels, menus, settings, quick input, dialogs, notifications, hovers, breadcrumbs, welcome page, chat text (`unicode-bidi: plaintext`, equivalent to `dir=auto`), Axiora webviews (`dir`/`lang`).
- Always LTR: code editors, terminal, minimap, debug console, keybindings editor, `pre`/`code` blocks.
- Known limits: tree indent guides hidden in RTL; some absolutely-positioned widgets and scrollbars stay on the physical side; chat input is a Monaco editor (bidi per line, not mirrored); ~4847 newer upstream VS Code strings are not in the 1.125-based language pack and show in English.

## Written, not tested (test on Windows)
1. Voice: set `axiora.voice.language` = `ar`, use a multilingual Whisper model (`ggml-base.bin`, not `.en`), dictate Arabic → Arabic text.
2. Arabic TTS: read an Arabic reply aloud (Windows SAPI needs an Arabic voice installed).
3. `axiora.chat.responseLanguage` with a real model: write in Arabic → reply in Arabic, code/comments/files in English.
4. Runtime button translation in extension notifications (Arabic labels, correct action fires).
5. Switch language on Windows: the app restarts automatically (no dialog) and reopens the same folder/editors, unsaved edits kept (tested on Linux both ways).
