# دمج تكامل Cursor يدوياً

هذا المجلد نسخة مستقلة من تكامل Cursor لـ Axiora Code. نفس التغيير مُطبَّق أصلاً في المستودع الذي أُنتج منه هذا المجلد. استخدم هذه الخطوات عندما تكون شجرتك المحلية بنفس المسارات وبنفس محتوى الملفات **قبل** هذا التغيير.

## ماذا تحصل عليه

1. عند التشغيل يقرأ Axiora سكربت التثبيت الرسمي لـ Cursor وينزّل أداة سطر الأوامر التي يسمّيها السكربت إلى تخزين الإضافة العام. السكربت نفسه لا يُنفَّذ.
2. قائمة تسجيل الدخول تحصل على **Continue with Cursor**. صفحة الترحيب تحصل على بطاقة Cursor، وجولة الإعداد تحصل على خطوة Cursor بجانب خطوة GitHub Copilot. الاثنتان تشغّلان `axiora.cursor.signIn`.
3. الأمر `/acp cursor <prompt>` في الدردشة يشغّل الأداة المنزَّلة كـ `agent acp` داخل المحرر. بعد `initialize` يرسل العميل `authenticate` مع `methodId: "cursor_login"`.

لا يُضاف أي مفتاح واجهة لـ Cursor. تسجيل الدخول بحساب Cursor الخاص بالمستخدم النهائي فقط.

## مصدر التنزيل الرسمي

التوثيق الرسمي للتثبيت: <https://cursor.com/docs/cli/installation>

- macOS و Linux و WSL: `curl https://cursor.com/install -fsS | bash`
- Windows: `irm 'https://cursor.com/install?win32=true' | iex`

لا توجد واجهة JSON مستقلة لرقم الإصدار. السكربت يثبّت الحزمة الحالية، مثلاً `https://downloads.cursor.com/lab/<version>/<os>/<arch>/agent-cli-package.tar.gz` (وعلى Windows: `.../windows/<arch>/agent-cli-package.zip`).

**قيد.** يجلب Axiora هذا السكربت، ويقبل فقط العناوين على `https://downloads.cursor.com/lab/`، وينزّل الأرشيف بـ `fetch`. الاستخراج بأمر `tar` في النظام (`tar --strip-components=1 -xzf` لملفات `.tar.gz`، و `tar -xf` ثم رفع محتويات `dist-package` لملف zip على Windows)، وهو نفس تخطيط السكربت الرسمي. لا يُمرَّر السكربت إلى الصدفة، لأن السكربت الرسمي يثبّت تحت `~/.local` أو `%LOCALAPPDATA%` ويعدّل PATH. كل تشغيل يعيد قراءة السكربت. إصدار جديد يستبدل النسخة المخزّنة وتُحذف مجلدات الإصدارات الأقدم. إذا تعذّر جلب السكربت ووُجد ملف تنفيذي مخزّن، يُبقى عليه. الإعداد `axiora.cursor.cliPath` أو المتغير `AXIORA_CURSOR_CLI` يتجاوز التنزيل. معماريات `ia32` والأنظمة غير Windows و macOS و Linux ليس لها حزمة رسمية.

توثيق الدخول: <https://cursor.com/docs/cli/reference/authentication> (`agent login` مع `NO_OPEN_BROWSER=1`). توثيق ACP: <https://cursor.com/docs/cli/acp> (`agent acp` ثم `initialize` ثم `authenticate` بالقيمة `{ methodId: "cursor_login" }`).

## انسخ الملفات الجديدة

من جذر المستودع، انسخ الملفات الأربعة مع الإبقاء على المسار النسبي (ترتيب المجلدات داخل `axiora-cursor-addon/` هو مسار الوجهة):

```bash
cp axiora-cursor-addon/extensions/axiora-local-ai/src/acpAuth.ts extensions/axiora-local-ai/src/acpAuth.ts
cp axiora-cursor-addon/extensions/axiora-local-ai/src/cursorCli.ts extensions/axiora-local-ai/src/cursorCli.ts
cp axiora-cursor-addon/extensions/axiora-local-ai/src/cursorCliResolve.ts extensions/axiora-local-ai/src/cursorCliResolve.ts
cp axiora-cursor-addon/extensions/axiora-local-ai/test/cursorIntegration.test.ts extensions/axiora-local-ai/test/cursorIntegration.test.ts
```

لا تعدّل مجلد `extensions/copilot`.

## طبّق كل تعديل

الملف `edits.patch` في هذا المجلد هو الفرق الموحّد الكامل لكل ملف موجود. الفروق لكل ملف تأتي أدناه. طبّقها بأي ترتيب. السطر الذي يبدأ بـ `-` هو النص الموجود أصلاً في ملفك (المرساة). السطر الذي يبدأ بـ `+` هو ما تضيفه أو تستبدل به. إذا كان `git apply` متاحاً وملفاتك مطابقة لهذا المستودع قبل التغيير، يمكنك تشغيل `git apply axiora-cursor-addon/edits.patch` مرة واحدة لكل الملفات.


### `extensions/axiora-language-pack-ar/translations/main.i18n.json`

النصوص العربية لزر تسجيل الدخول، وبطاقة الترحيب، وبطاقة الجولة، وزر الإعداد الأولي، وفهرس الإعدادات، وتسميات الإعدادات.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/extensions/axiora-language-pack-ar/translations/main.i18n.json b/extensions/axiora-language-pack-ar/translations/main.i18n.json
index 919302a1..278a8953 100644
--- a/extensions/axiora-language-pack-ar/translations/main.i18n.json
+++ b/extensions/axiora-language-pack-ar/translations/main.i18n.json
@@ -12297,6 +12297,7 @@
 		"vs/workbench/contrib/chat/browser/chatSetup/chatSetupRunner": {
 			"chatWorkspaceTrust": "ميزات الذكاء الاصطناعي مدعومة حاليًا في مساحات العمل المعتمدة فقط.",
 			"continueWith": "تواصل مع {0}",
+			"continueWithCursor": "المتابعة باستخدام Cursor",
 			"enableMore": "تمكين المزيد من ميزات الذكاء الاصطناعي",
 			"settings": "من خلال المتابعة، فإنك توافق على [الشروط والأحكام]({1}) و[بيان الخصوصية]({2}) من {0}. يمكن لـ {3} Copilot عرض الاقتراحات من [التعليمات البرمجية العامة]({4}) واستخدام بياناتك لتحسين المنتج. يمكنك تعديل [الإعدادات]({5}) هذه في أي وقت.",
 			"settingsAnonymous": "من خلال المتابعة، فإنك توافق على [الشروط والأحكام]({1}) و[بيان الخصوصية]({2}) من {0}.",
@@ -20278,6 +20279,7 @@
 			"axiora.toc.integrations.mcp": "خادم MCP",
 			"axiora.toc.integrations.browser": "المتصفح",
 			"axiora.toc.integrations.remote": "الوصول البعيد والمشاركة",
+			"axiora.toc.integrations.cursor": "Cursor",
 			"axiora.toc.features.axioraCheckpoints": "نقاط الحفظ",
 			"axiora.toc.features.axioraLintFix": "إصلاح الأخطاء بالذكاء الاصطناعي",
 			"axiora.toc.features.axioraSolo": "الوكيل المنفرد",
@@ -24453,7 +24455,10 @@
 			"axiora.welcome.setup": "إعداد الذكاء الاصطناعي",
 			"axiora.welcome.free": "الحصول على مفتاح مجاني",
 			"axiora.welcome.enable": "تفعيل مساعد الذكاء الاصطناعي",
-			"axiora.welcome.enableDetail": "الصق مفتاحاً واحداً من OpenRouter أو Groq أو Gemini أو Anthropic أو OpenAI — أو استخدم Ollama على جهازك."
+			"axiora.welcome.enableDetail": "الصق مفتاحاً واحداً من OpenRouter أو Groq أو Gemini أو Anthropic أو OpenAI — أو استخدم Ollama على جهازك.",
+			"axiora.welcome.cursor.title": "Cursor",
+			"axiora.welcome.cursor.detail": "سجّل الدخول بحساب Cursor. يعمل الوكيل داخل المحرر.",
+			"axiora.welcome.cursor.signIn": "تسجيل الدخول باستخدام Cursor"
 		},
 		"vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.contribution": {
 			"deprecationMessage": "مهمل، استخدم 'workbench.reduceMotion' العام.",
@@ -24577,6 +24582,9 @@
 			"gettingStarted.copilotSetup.description": "يمكنك استخدام [Copilot]({0}) لإنشاء تعليمات برمجية في ملفات متعددة وإصلاح الأخطاء وطرح أسئلة حول التعليمات البرمجية الخاصة بك وغير ذلك الكثير باستخدام اللغة الطبيعية.",
 			"gettingStarted.copilotSetup.terms": "من خلال الاستمرار في استخدام Copilot {0}، فإنك تقبل [الشروط والأحكام]({2}) و[بيان الخصوصية]({3}) لـ {1}",
 			"gettingStarted.copilotSetup.title": "استخدم ميزات الذكاء الاصطناعي مع Copilot مجانًا",
+			"gettingStarted.cursorAgent.title": "استخدم وكيل Cursor",
+			"gettingStarted.cursorAgent.description": "سجّل الدخول بحساب Cursor وشغّل وكيل Cursor داخل المحرر. ينزّل Axiora أداة Cursor CLI الرسمية نيابةً عنك.\n{0}",
+			"gettingStarted.cursorAgent.signIn": "تسجيل الدخول باستخدام Cursor",
 			"gettingStarted.debug.description.interpolated": "سرّع حلقة التعديل والبناء والاختبار والتصحيح عن طريق تكوين تكوين تشغيل.\r\n{0}",
 			"gettingStarted.debug.title": "راقب الكود قيد العمل",
 			"gettingStarted.dictation.description.interpolated": "يتيح لك الإملاء كتابة الكود والنص باستخدام صوتك. يمكن تفعيله باستخدام الأمر الصوتي: بدء الإملاء في المحرر.\r\n{0}\r\n للإملاء في الطرفية، استخدم الأوامر الصوتية: بدء الإملاء في الطرفية والصوتي: إيقاف الإملاء في الطرفية.\r\n{1}\r\n{2}",
@@ -24744,6 +24752,8 @@
 			"onboarding.sessions.runAnywhere.desc": "قم بتشغيل المعالجات محليًا للمهام التفاعلية، في الخلفية باستخدام Copilot CLI، أو في السحابة باستخدام المعالجات السحابية التي تفتح طلب سحب ليقوم فريقك بمراجعته.",
 			"onboarding.sessions.signInNudge": "يلزم تسجيل الدخول للوصول إلى الميزات المدعومة بالذكاء الاصطناعي",
 			"onboarding.signIn.apple": "المتابعة باستخدام Apple",
+			"onboarding.signIn.cursor": "المتابعة باستخدام Cursor",
+			"onboarding.signIn.cursor.aria": "المتابعة باستخدام Cursor",
 			"onboarding.signIn.disclaimer.copilotPrefix": "قد يعرض GitHub Copilot {0}",
 			"onboarding.signIn.disclaimer.improveSuffix": "الاقتراحات واستخدام بياناتك لتحسين المنتج.",
 			"onboarding.signIn.disclaimer.middle": "و",
@@ -29413,6 +29423,9 @@
 			"axiora.label.axiora.share.endpoint": "خادم المشاركة",
 			"axiora.label.axiora.embed.baseUrl": "العنوان الأساسي للتضمين",
 			"axiora.label.axiora.acp.agents": "وكلاء ACP",
+			"axiora.cat.Cursor": "Cursor",
+			"axiora.label.axiora.cursor.enabled": "مُفعّل",
+			"axiora.label.axiora.cursor.cliPath": "مسار أداة سطر الأوامر",
 			"axiora.label.axiora.language.display": "لغة العرض",
 			"axiora.label.axiora.language.mirrorLayout": "تخطيط من اليمين لليسار للعربية",
 			"axiora.label.axiora.language.statusBar": "زر تبديل اللغة في شريط الحالة",
```

### `extensions/axiora-local-ai/l10n/bundle.l10n.ar.json`

نصوص وقت التشغيل العربية. نفس استبدال المفتاح كما في الحزمة الإنجليزية.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/extensions/axiora-local-ai/l10n/bundle.l10n.ar.json b/extensions/axiora-local-ai/l10n/bundle.l10n.ar.json
index d7e182b9..2eaf38a4 100644
--- a/extensions/axiora-local-ai/l10n/bundle.l10n.ar.json
+++ b/extensions/axiora-local-ai/l10n/bundle.l10n.ar.json
@@ -1,5 +1,18 @@
 {
-	"No ACP agents configured. Add one in **Settings → axiora.acp.agents**, e.g. `{ \"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"] }`.": "لا يوجد وكلاء ACP مُعدّون. أضف واحداً في **الإعدادات ← axiora.acp.agents**، مثل `{ \"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"] }`.",
+	"No ACP agents configured. Add one in **Settings → axiora.acp.agents**, e.g. `{ \"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"] }`. Cursor is added automatically once its CLI has downloaded.": "لا يوجد وكلاء ACP مُعدّون. أضف واحداً في **الإعدادات ← axiora.acp.agents**، مثل `{ \"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"] }`. يُضاف Cursor تلقائياً بعد اكتمال تنزيل أداة سطر الأوامر.",
+	"Cursor CLI is not ready: {0}": "أداة Cursor CLI غير جاهزة: {0}",
+	"Signing in to {0}…": "جارٍ تسجيل الدخول إلى {0}…",
+	"Cursor plan": "خطة Cursor",
+	"Accept": "قبول",
+	"Cursor CLI was not found at {0}.": "لم يُعثر على Cursor CLI في {0}.",
+	"Downloading Cursor Agent…": "جارٍ تنزيل وكيل Cursor…",
+	"The Cursor package did not contain the agent executable.": "حزمة Cursor لا تحتوي على ملف الوكيل التنفيذي.",
+	"Cursor Agent is turned off in Settings (axiora.cursor.enabled).": "وكيل Cursor متوقف في الإعدادات (axiora.cursor.enabled).",
+	"Signing in to Cursor…": "جارٍ تسجيل الدخول إلى Cursor…",
+	"Cursor sign-in did not finish.": "لم يكتمل تسجيل الدخول إلى Cursor.",
+	"Signed in to Cursor.": "تم تسجيل الدخول إلى Cursor.",
+	"Cursor CLI {0}": "Cursor CLI {0}",
+	"Cursor CLI download failed: {0}. Axiora will try again on the next launch.": "فشل تنزيل Cursor CLI: {0}. سيحاول Axiora مرة أخرى عند التشغيل التالي.",
 	"Starting {0} (ACP)…": "جارٍ تشغيل {0} (ACP)…",
 	"Allow": "سماح",
 	"{0} wants to write {1}": "يريد {0} كتابة {1}",
```

### `extensions/axiora-local-ai/l10n/bundle.l10n.json`

نصوص وقت التشغيل الإنجليزية التي يستخدمها `vscode.l10n.t`. استبدل مفتاح «No ACP agents configured» القديم ولا تُبقِ المفتاحين معاً.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/extensions/axiora-local-ai/l10n/bundle.l10n.json b/extensions/axiora-local-ai/l10n/bundle.l10n.json
index 6b01cc7c..f2ca2e90 100644
--- a/extensions/axiora-local-ai/l10n/bundle.l10n.json
+++ b/extensions/axiora-local-ai/l10n/bundle.l10n.json
@@ -1,5 +1,18 @@
 {
-	"No ACP agents configured. Add one in **Settings → axiora.acp.agents**, e.g. `{ \"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"] }`.": "No ACP agents configured. Add one in **Settings → axiora.acp.agents**, e.g. `{ \"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"] }`.",
+	"No ACP agents configured. Add one in **Settings → axiora.acp.agents**, e.g. `{ \"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"] }`. Cursor is added automatically once its CLI has downloaded.": "No ACP agents configured. Add one in **Settings → axiora.acp.agents**, e.g. `{ \"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"] }`. Cursor is added automatically once its CLI has downloaded.",
+	"Cursor CLI is not ready: {0}": "Cursor CLI is not ready: {0}",
+	"Signing in to {0}…": "Signing in to {0}…",
+	"Cursor plan": "Cursor plan",
+	"Accept": "Accept",
+	"Cursor CLI was not found at {0}.": "Cursor CLI was not found at {0}.",
+	"Downloading Cursor Agent…": "Downloading Cursor Agent…",
+	"The Cursor package did not contain the agent executable.": "The Cursor package did not contain the agent executable.",
+	"Cursor Agent is turned off in Settings (axiora.cursor.enabled).": "Cursor Agent is turned off in Settings (axiora.cursor.enabled).",
+	"Signing in to Cursor…": "Signing in to Cursor…",
+	"Cursor sign-in did not finish.": "Cursor sign-in did not finish.",
+	"Signed in to Cursor.": "Signed in to Cursor.",
+	"Cursor CLI {0}": "Cursor CLI {0}",
+	"Cursor CLI download failed: {0}. Axiora will try again on the next launch.": "Cursor CLI download failed: {0}. Axiora will try again on the next launch.",
 	"Starting {0} (ACP)…": "Starting {0} (ACP)…",
 	"Allow": "Allow",
 	"{0} wants to write {1}": "{0} wants to write {1}",
```

### `extensions/axiora-local-ai/package.json`

أضف حدثي التفعيل للأمرين، وأوامر تسجيل الدخول والحالة، وقسم الإعدادات `axiora.integrations.cursor` (`axiora.cursor.enabled` و `axiora.cursor.cliPath`).

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/extensions/axiora-local-ai/package.json b/extensions/axiora-local-ai/package.json
index c032eaf2..c87e5f55 100644
--- a/extensions/axiora-local-ai/package.json
+++ b/extensions/axiora-local-ai/package.json
@@ -20,6 +20,8 @@
   },
   "activationEvents": [
     "onStartupFinished",
+    "onCommand:axiora.cursor.signIn",
+    "onCommand:axiora.cursor.status",
     "onTerminalProfile:axiora.agentTerminal",
     "onLanguage:python",
     "onLanguage:shellscript",
@@ -1231,6 +1233,16 @@
         "title": "%cmd.axiora.agents.externalCli.title%",
         "category": "%cat.Axiora_AI%"
       },
+      {
+        "command": "axiora.cursor.signIn",
+        "title": "%cmd.axiora.cursor.signIn.title%",
+        "category": "%cat.Axiora_AI%"
+      },
+      {
+        "command": "axiora.cursor.status",
+        "title": "%cmd.axiora.cursor.status.title%",
+        "category": "%cat.Axiora_AI%"
+      },
       {
         "command": "axiora.canvas.open",
         "title": "%cmd.axiora.canvas.open.title%",
@@ -3064,6 +3076,24 @@
             "order": 5
           }
         }
+      },
+      {
+        "id": "axiora.integrations.cursor",
+        "title": "%cfgsec.axiora.integrations.cursor.title%",
+        "properties": {
+          "axiora.cursor.enabled": {
+            "type": "boolean",
+            "default": true,
+            "markdownDescription": "%cfg.axiora.cursor.enabled.markdownDescription%",
+            "order": 1
+          },
+          "axiora.cursor.cliPath": {
+            "type": "string",
+            "default": "",
+            "markdownDescription": "%cfg.axiora.cursor.cliPath.markdownDescription%",
+            "order": 2
+          }
+        }
       }
     ],
     "submenus": [
```

### `extensions/axiora-local-ai/package.nls.ar.json`

العناوين والوصف العربية لنفس المفاتيح.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/extensions/axiora-local-ai/package.nls.ar.json b/extensions/axiora-local-ai/package.nls.ar.json
index 1cd9c1b6..da1150f7 100644
--- a/extensions/axiora-local-ai/package.nls.ar.json
+++ b/extensions/axiora-local-ai/package.nls.ar.json
@@ -498,7 +498,12 @@
 	"cfg.axiora.collab.relayUrl.markdownDescription": "خادم الترحيل المستضاف ذاتياً للتعاون المباشر (`node bin/axiora-relay.mjs`). الرسائل مشفّرة من طرف إلى طرف؛ ولا يرى الخادم إلا نصاً مشفّراً.",
 	"cfg.axiora.share.endpoint.markdownDescription": "خادم ينشر المحادثات المشتركة: يستقبل `POST {title, markdown, html}` ويعيد `{url}`.",
 	"cfg.axiora.embed.baseUrl.markdownDescription": "العنوان العام الذي تستضيف عليه `.axiora/embeds`؛ يُستخدم في مقتطفات iframe المنسوخة.",
-	"cfg.axiora.acp.agents.markdownDescription": "وكلاء خارجيون يُتواصل معهم عبر بروتوكول Agent Client Protocol، مثل `[{\"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"]}]`.",
+	"cfg.axiora.acp.agents.markdownDescription": "وكلاء خارجيون يُتواصل معهم عبر بروتوكول Agent Client Protocol، مثل `[{\"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"]}]`. يُضاف Cursor تلقائياً من أداة سطر الأوامر التي يُنزّلها التطبيق (`agent acp`) ما لم يوجد إدخال باسم `cursor`.",
+	"cfgsec.axiora.integrations.cursor.title": "Axiora: Cursor",
+	"cfg.axiora.cursor.enabled.markdownDescription": "تنزيل أداة Cursor CLI الرسمية إلى مجلد بيانات Axiora وتشغيلها داخل المحرر عبر ACP. تسجيل الدخول يستخدم حساب Cursor الخاص بك (`agent login`). لا يُخزَّن مفتاح واجهة في التطبيق.",
+	"cfg.axiora.cursor.cliPath.markdownDescription": "مسار بديل لملف Cursor CLI. إذا كان فارغاً تُستخدم النسخة التي ينزّلها Axiora. المتغير `AXIORA_CURSOR_CLI` يتجاوز هذا الإعداد.",
+	"cmd.axiora.cursor.signIn.title": "تسجيل الدخول باستخدام Cursor",
+	"cmd.axiora.cursor.status.title": "حالة حساب Cursor",
 	"chat.axiora.local.description": "ذكاء اصطناعي محلي (Ollama / مفتاحك الخاص): مراجعة، مواصفات، ذاكرة",
 	"chat.axiora.local.cmd.review": "مراجعة التغييرات غير المحفوظة (git diff) محلياً",
 	"chat.axiora.local.cmd.spec": "تخطيط ميزة: requirements.md و design.md و tasks.md",
```

### `extensions/axiora-local-ai/package.nls.json`

عناوين ووصف إنجليزية للأوامر والإعدادات الجديدة، وتحديث وصف وكلاء ACP.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/extensions/axiora-local-ai/package.nls.json b/extensions/axiora-local-ai/package.nls.json
index 30be0b75..21078099 100644
--- a/extensions/axiora-local-ai/package.nls.json
+++ b/extensions/axiora-local-ai/package.nls.json
@@ -498,7 +498,12 @@
 	"cfg.axiora.collab.relayUrl.markdownDescription": "Your self-hosted relay for live collaboration (`node bin/axiora-relay.mjs`). Messages are end-to-end encrypted; the relay sees only ciphertext.",
 	"cfg.axiora.share.endpoint.markdownDescription": "Server that publishes shared chats: receives `POST {title, markdown, html}` and returns `{url}`.",
 	"cfg.axiora.embed.baseUrl.markdownDescription": "Public address where you host `.axiora/embeds`; used in copied iframe snippets.",
-	"cfg.axiora.acp.agents.markdownDescription": "External agents spoken to over the Agent Client Protocol, e.g. `[{\"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"]}]`.",
+	"cfg.axiora.acp.agents.markdownDescription": "External agents spoken to over the Agent Client Protocol, e.g. `[{\"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"]}]`. Cursor is added automatically from the downloaded CLI (`agent acp`) unless an entry named `cursor` is already listed.",
+	"cfgsec.axiora.integrations.cursor.title": "Axiora: Cursor",
+	"cfg.axiora.cursor.enabled.markdownDescription": "Download the official Cursor CLI into Axiora's data folder and run it inside the editor over ACP. Sign-in uses your own Cursor account (`agent login`). No API key is stored in the app.",
+	"cfg.axiora.cursor.cliPath.markdownDescription": "Override path to the Cursor CLI executable. Empty uses the copy Axiora downloads. `AXIORA_CURSOR_CLI` overrides this.",
+	"cmd.axiora.cursor.signIn.title": "Sign In with Cursor",
+	"cmd.axiora.cursor.status.title": "Cursor Account Status",
 	"chat.axiora.local.description": "Local AI (Ollama / your own key): review, specs, memory",
 	"chat.axiora.local.cmd.review": "Review uncommitted changes (git diff) locally",
 	"chat.axiora.local.cmd.spec": "Plan a feature: requirements.md, design.md, tasks.md",
```

### `extensions/axiora-local-ai/src/acpClient.ts`

استدعِ `authenticate` بعد `initialize` (العميل القديم كان يتخطاه)، وسجّل وكيل Cursor المدمج (`agent acp` مع `authMethod: cursor_login`)، وعالج طلبات ACP الخاصة بـ Cursor.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/extensions/axiora-local-ai/src/acpClient.ts b/extensions/axiora-local-ai/src/acpClient.ts
index 9c9b5455..e9c85092 100644
--- a/extensions/axiora-local-ai/src/acpClient.ts
+++ b/extensions/axiora-local-ai/src/acpClient.ts
@@ -1,26 +1,39 @@
 /*---------------------------------------------------------------------------------------------
  *  External agents inside the editor:
  *  - ACP client (Agent Client Protocol, JSON-RPC over stdio): agents from axiora.acp.agents
- *    [{name, command, args}] (e.g. Gemini CLI --experimental-acp, claude-code-acp, Goose…)
+ *    [{name, command, args, authMethod?}] (e.g. Gemini CLI --experimental-acp, claude-code-acp, Goose…)
  *    stream into chat via "/acp [name] <prompt>"; their file reads/writes go through the editor
  *    and writes ask for permission.
- *  - Run External Agent CLI: detects claude / codex / gemini / aider / opencode / goose on
+ *  - Cursor is registered automatically from the CLI downloaded into app data
+ *    (`agent acp`), unless Settings already lists an agent named "cursor".
+ *    After initialize, Cursor is sent authenticate { methodId: "cursor_login" }.
+ *    Other agents are authenticated only when they advertise authMethods.
+ *  - Run External Agent CLI: detects claude / codex / gemini / aider / opencode / goose / agent on
  *    PATH and starts it in an editor terminal for the current folder.
  *--------------------------------------------------------------------------------------------*/
 import * as vscode from 'vscode';
 import * as cp from 'child_process';
 import * as fs from 'fs';
 import * as path from 'path';
+import { loginUrlFromAuthResult, selectAcpAuthMethod } from './acpAuth';
+import { cursorExecutableNow, ensureCursorCli, openCursorLoginUrl } from './cursorCli';
 import { chatCommands, register, wsRoot } from './util';
 
-type Agent = { name: string; command: string; args?: string[] };
+type Agent = { name: string; command: string; args?: string[]; authMethod?: string };
 const onPath = (c: string) => (process.env.PATH ?? '').split(path.delimiter).concat(path.join(process.env.HOME ?? '', '.local', 'bin')).some(d => { try { return fs.statSync(path.join(d, c)).isFile(); } catch { return false; } });
 export class AcpConnection {
 	private p: cp.ChildProcess; private id = 0; private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>(); private buf = '';
-	onUpdate: (u: any) => void = () => undefined; onRequest: (method: string, params: any) => Promise<any> = async () => ({}); stderr = '';
+	onUpdate: (u: any) => void = () => undefined; onRequest: (method: string, params: any) => Promise<any> = async () => ({}); onNotify: (method: string, params: any) => void = () => undefined; stderr = '';
+	/** While true, an https URL on stderr is treated as the Cursor login page. */
+	watchLoginUrls = false;
 	constructor(a: Agent, cwd: string) {
-		this.p = cp.spawn(a.command, a.args ?? [], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PATH: `${process.env.PATH}${path.delimiter}${path.join(process.env.HOME ?? '', '.local', 'bin')}` } });
-		this.p.stderr!.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
+		this.p = cp.spawn(a.command, a.args ?? [], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_OPEN_BROWSER: '1', PATH: `${process.env.PATH}${path.delimiter}${path.join(process.env.HOME ?? '', '.local', 'bin')}` } });
+		this.p.stderr!.on('data', d => {
+			this.stderr = (this.stderr + d).slice(-4000);
+			if (!this.watchLoginUrls) { return; }
+			const match = /https:\/\/[^\s'")]+/.exec(this.stderr);
+			if (match) { openCursorLoginUrl(match[0].replace(/[.,)]$/, '')); }
+		});
 		this.p.on('exit', c => { for (const v of this.pending.values()) { v.rej(new Error(`agent exited (${c}) ${this.stderr.slice(-300)}`)); } this.pending.clear(); });
 		this.p.on('error', e => { for (const v of this.pending.values()) { v.rej(e); } this.pending.clear(); });
 		this.p.stdout!.on('data', d => { this.buf += d; let i; while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1); if (l) { try { void this.handle(JSON.parse(l)); } catch { /* not json */ } } } });
@@ -29,30 +42,77 @@ export class AcpConnection {
 	private async handle(m: any) {
 		if (m.id !== undefined && (m.result !== undefined || m.error) && this.pending.has(m.id)) { const p = this.pending.get(m.id)!; this.pending.delete(m.id); return m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
 		if (m.method === 'session/update') { return this.onUpdate(m.params?.update); }
+		if (m.method && m.id === undefined) { return this.onNotify(m.method, m.params); }
 		if (m.method && m.id !== undefined) { try { this.send({ id: m.id, result: await this.onRequest(m.method, m.params) }); } catch (e) { this.send({ id: m.id, error: { code: -32603, message: (e as Error).message } }); } }
 	}
 	request(method: string, params: any): Promise<any> { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.send({ id, method, params }); }); }
 	notify(method: string, params: any) { this.send({ method, params }); }
 	kill() { this.p.kill(); }
 }
+
+async function cursorAgent(): Promise<Agent | undefined> {
+	if (!vscode.workspace.getConfiguration('axiora.cursor').get<boolean>('enabled', true)) { return undefined; }
+	const command = cursorExecutableNow() ?? await ensureCursorCli();
+	return { name: 'cursor', command, args: ['acp'], authMethod: 'cursor_login' };
+}
+
 export function activate(ctx: vscode.ExtensionContext) {
 	const agents = () => vscode.workspace.getConfiguration('axiora.acp').get<Agent[]>('agents', []);
 	const sessions = new Map<string, { c: AcpConnection; sid: string }>();
 	ctx.subscriptions.push({ dispose: () => sessions.forEach(s => s.c.kill()) });
 	chatCommands.set('acp', async (req, stream, token) => {
-		const all = agents(); if (!all.length) { stream.markdown(vscode.l10n.t("No ACP agents configured. Add one in **Settings → axiora.acp.agents**, e.g. `{ \"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"] }`.")); return; }
-		const first = req.prompt.trim().split(/\s+/)[0]; const a = all.find(x => x.name === first) ?? all[0]; const prompt = a.name === first ? req.prompt.trim().slice(first.length).trim() : req.prompt.trim();
+		const configured = agents();
+		const first = req.prompt.trim().split(/\s+/)[0];
+		const cursorOn = vscode.workspace.getConfiguration('axiora.cursor').get<boolean>('enabled', true);
+		if (first === 'cursor' && !cursorOn && !configured.some(a => a.name === 'cursor')) { stream.markdown(vscode.l10n.t("Cursor Agent is turned off in Settings (axiora.cursor.enabled).")); return; }
+		const needCursor = cursorOn && !configured.some(a => a.name === 'cursor') && (first === 'cursor' || !configured.length || !!cursorExecutableNow());
+		let builtin: Agent | undefined;
+		if (needCursor) {
+			try { builtin = await cursorAgent(); } catch (e) {
+				if (first === 'cursor' || !configured.length) { stream.markdown(vscode.l10n.t("Cursor CLI is not ready: {0}", (e as Error).message)); return; }
+			}
+		}
+		const all = builtin ? [builtin, ...configured] : configured;
+		if (!all.length) { stream.markdown(vscode.l10n.t("No ACP agents configured. Add one in **Settings → axiora.acp.agents**, e.g. `{ \"name\": \"gemini\", \"command\": \"gemini\", \"args\": [\"--experimental-acp\"] }`. Cursor is added automatically once its CLI has downloaded.")); return; }
+		const named = all.find(x => x.name === first);
+		const a = named ?? configured[0] ?? all[0];
+		const prompt = named ? req.prompt.trim().slice(first.length).trim() : req.prompt.trim();
 		const root = wsRoot()?.fsPath ?? process.cwd();
 		let s = sessions.get(a.name);
 		if (!s) {
 			stream.progress(vscode.l10n.t("Starting {0} (ACP)…", a.name)); const c = new AcpConnection(a, root);
 			c.onRequest = async (method, p) => {
 				if (method === 'fs/read_text_file') { const d = await vscode.workspace.openTextDocument(vscode.Uri.file(p.path)); const L = d.getText().split('\n'); return { content: p.line ? L.slice(p.line - 1, p.limit ? p.line - 1 + p.limit : undefined).join('\n') : d.getText() }; }
-				if (method === 'fs/write_text_file') { const ok = await vscode.window.showWarningMessage(vscode.l10n.t("{0} wants to write {1}", a.name, vscode.workspace.asRelativePath(p.path)), { modal: true }, 'Allow'); if (ok !== 'Allow') { throw new Error('denied by user'); } fs.mkdirSync(path.dirname(p.path), { recursive: true }); fs.writeFileSync(p.path, p.content); return null; }
+				if (method === 'fs/write_text_file') { const ok = await vscode.window.showWarningMessage(vscode.l10n.t("{0} wants to write {1}", a.name, vscode.workspace.asRelativePath(p.path)), { modal: true }, vscode.l10n.t("Allow")); if (ok !== vscode.l10n.t("Allow")) { throw new Error('denied by user'); } fs.mkdirSync(path.dirname(p.path), { recursive: true }); fs.writeFileSync(p.path, p.content); return null; }
 				if (method === 'session/request_permission') { const opts = (p.options ?? []) as { optionId: string; name: string; kind: string }[]; const pick = await vscode.window.showQuickPick(opts.map(o => ({ label: o.name, description: o.kind, o })), { placeHolder: `${a.name}: ${p.toolCall?.title ?? 'permission requested'}` }); return { outcome: pick ? { outcome: 'selected', optionId: pick.o.optionId } : { outcome: 'cancelled' } }; }
+				if (method === 'cursor/ask_question') {
+					const questions = (p.questions ?? []) as { id: string; prompt: string; options: { id: string; label: string }[]; allowMultiple?: boolean }[];
+					const answers: { questionId: string; selectedOptionIds: string[] }[] = [];
+					for (const q of questions) {
+						const picks = await vscode.window.showQuickPick(q.options.map(o => ({ label: o.label, id: o.id })), { title: p.title, placeHolder: q.prompt, canPickMany: !!q.allowMultiple });
+						const selected = Array.isArray(picks) ? picks : picks ? [picks] : [];
+						if (!selected.length) { return { outcome: { outcome: 'cancelled' } }; }
+						answers.push({ questionId: q.id, selectedOptionIds: selected.map(o => o.id) });
+					}
+					return { outcome: { outcome: 'answered', answers } };
+				}
+				if (method === 'cursor/create_plan') {
+					const ok = await vscode.window.showInformationMessage(p.name || vscode.l10n.t("Cursor plan"), { modal: true, detail: String(p.overview ?? p.plan ?? '').slice(0, 1500) }, vscode.l10n.t("Accept"));
+					return { outcome: ok === vscode.l10n.t("Accept") ? { outcome: 'accepted' } : { outcome: 'rejected' } };
+				}
 				throw new Error(`unsupported: ${method}`);
 			};
-			await c.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } } });
+			const init = await c.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } }, clientInfo: { name: 'axiora-code', version: '1.0.0' } });
+			const methodId = selectAcpAuthMethod(a, init);
+			if (methodId) {
+				stream.progress(vscode.l10n.t("Signing in to {0}…", a.name));
+				c.watchLoginUrls = true;
+				try {
+					const auth = await c.request('authenticate', { methodId });
+					const url = loginUrlFromAuthResult(auth);
+					if (url) { openCursorLoginUrl(url); }
+				} finally { c.watchLoginUrls = false; }
+			}
 			const r = await c.request('session/new', { cwd: root, mcpServers: [] }); s = { c, sid: r.sessionId }; sessions.set(a.name, s);
 		}
 		const cur = s;
@@ -63,15 +123,23 @@ export function activate(ctx: vscode.ExtensionContext) {
 			else if (u.sessionUpdate === 'tool_call') { stream.markdown(`\n\n> 🔧 ${u.title ?? u.kind ?? 'tool'}${u.status ? ` · ${u.status}` : ''}\n\n`); }
 			else if (u.sessionUpdate === 'plan' && u.entries) { stream.markdown(vscode.l10n.t("\n\n**Plan:**\n{0}\n\n", u.entries.map((e: any) => `- [${e.status === 'completed' ? 'x' : ' '}] ${e.content}`).join('\n'))); }
 		};
+		cur.c.onNotify = (method, p) => {
+			if (method === 'cursor/update_todos' && Array.isArray(p?.todos)) { stream.progress(p.todos.map((t: { content?: string; status?: string }) => `${t.status ?? ''} ${t.content ?? ''}`).join(' · ').slice(0, 120)); }
+			else if (method === 'cursor/task') { stream.markdown(`\n\n> ${p?.description ?? 'task'}\n\n`); }
+			else if (method === 'cursor/generate_image') { stream.markdown(`\n\n> ${p?.description ?? 'image'}${p?.filePath ? ` · ${p.filePath}` : ''}\n\n`); }
+		};
 		token.onCancellationRequested(() => cur.c.notify('session/cancel', { sessionId: cur.sid }));
 		const res = await cur.c.request('session/prompt', { sessionId: cur.sid, prompt: [{ type: 'text', text: prompt }] });
 		stream.markdown(`\n\n_${a.name} · ${res?.stopReason ?? 'done'}_`);
 	});
 	register(ctx, 'axiora.agents.externalCli', async () => {
-		const known = [['claude', 'Claude Code'], ['codex', 'OpenAI Codex CLI'], ['gemini', 'Gemini CLI'], ['aider', 'Aider'], ['opencode', 'opencode'], ['goose', 'Goose'], ['axiora-agent', 'Axiora headless agent']];
-		const found = known.filter(([c]) => onPath(c));
+		const known = [['claude', 'Claude Code'], ['codex', 'OpenAI Codex CLI'], ['gemini', 'Gemini CLI'], ['aider', 'Aider'], ['opencode', 'opencode'], ['goose', 'Goose'], ['agent', 'Cursor Agent'], ['axiora-agent', 'Axiora headless agent']];
+		const cursorExe = vscode.workspace.getConfiguration('axiora.cursor').get<boolean>('enabled', true) ? cursorExecutableNow() : undefined;
+		const found = known.filter(([c]) => c === 'agent' ? !!cursorExe || onPath(c) : onPath(c));
 		const items = [...found.map(([c, n]) => ({ label: `$(terminal) ${n}`, description: c, c })), ...known.filter(k => !found.includes(k)).map(([c, n]) => ({ label: `$(circle-slash) ${n}`, description: `${c} — not installed`, c: '' }))];
 		const p = await vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t("Run an external agent CLI in the editor") }); if (!p?.c) { return; }
-		const t = vscode.window.createTerminal({ name: p.description!, cwd: wsRoot()?.fsPath, location: vscode.TerminalLocation.Editor }); t.show(); t.sendText(p.c === 'axiora-agent' ? 'axiora-agent --help' : p.c);
+		let cmd = p.c === 'axiora-agent' ? 'axiora-agent --help' : p.c;
+		if (p.c === 'agent') { const exe = cursorExe ?? await ensureCursorCli(); cmd = exe.includes(' ') ? `"${exe}"` : exe; }
+		const t = vscode.window.createTerminal({ name: p.description!, cwd: wsRoot()?.fsPath, location: vscode.TerminalLocation.Editor }); t.show(); t.sendText(cmd);
 	});
 }
```

### `extensions/axiora-local-ai/src/features.ts`

استورد `cursorCli` وضعه أولاً في `activateFeatures` حتى يُجهَّز التخزين قبل ACP.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/extensions/axiora-local-ai/src/features.ts b/extensions/axiora-local-ai/src/features.ts
index ff195a78..c911655b 100644
--- a/extensions/axiora-local-ai/src/features.ts
+++ b/extensions/axiora-local-ai/src/features.ts
@@ -12,6 +12,7 @@ import * as texSync from './texSync';
 import * as platformKit from './platformKit';
 import * as languageServers from './languageServers';
 import * as designCanvas from './designCanvas';
+import * as cursorCli from './cursorCli';
 import * as acpClient from './acpClient';
 import * as insight from './insight';
 import * as quality from './quality';
@@ -84,5 +85,5 @@ import * as terminalNL from './terminalNL';
 import * as commitMsg from './commitMsg';
 import * as aiActions from './aiActions';
 export function activateFeatures(ctx: vscode.ExtensionContext) {
-	for (const f of [onboarding, chatSeries, approval, drafts, services, tools, alternatives, collab, connectors, texSync, platformKit, languageServers, designCanvas, acpClient, insight, quality, appKit, runner, agentPlus, devLoop, mdVisual, uiGen, buildAnalyzer, projects, kernelDocs, profiler, selectionOps, termBlocks, agentWork, promptOps, github, cliAgent, orchestrator, codemap, nextEdit, implementComment, depComplete, liveContext, docsIndex, agents, keepAwake, dotfiles, deploy, crashAnalyze, arena, automations, security, orgMode, hexView, multibuffer, userScripts, whichKey, remote2, shareChat, sshFs, shelve, rebase, dataCells, docsTypeset, kubernetes, mcpServer, docker, database, htmlPreview, vim, structural, goals, lintLoop, macros, usage, sessions, gitExtras, editorConfig, editing, httpClient, csvTable, bookmarks, debugThreads, webSearch, repoMap, promptTools, terminalNL, commitMsg, aiActions]) { try { f.activate(ctx); } catch (e) { console.error(e); } }
+	for (const f of [cursorCli, onboarding, chatSeries, approval, drafts, services, tools, alternatives, collab, connectors, texSync, platformKit, languageServers, designCanvas, acpClient, insight, quality, appKit, runner, agentPlus, devLoop, mdVisual, uiGen, buildAnalyzer, projects, kernelDocs, profiler, selectionOps, termBlocks, agentWork, promptOps, github, cliAgent, orchestrator, codemap, nextEdit, implementComment, depComplete, liveContext, docsIndex, agents, keepAwake, dotfiles, deploy, crashAnalyze, arena, automations, security, orgMode, hexView, multibuffer, userScripts, whichKey, remote2, shareChat, sshFs, shelve, rebase, dataCells, docsTypeset, kubernetes, mcpServer, docker, database, htmlPreview, vim, structural, goals, lintLoop, macros, usage, sessions, gitExtras, editorConfig, editing, httpClient, csvTable, bookmarks, debugThreads, webSearch, repoMap, promptTools, terminalNL, commitMsg, aiActions]) { try { f.activate(ctx); } catch (e) { console.error(e); } }
 }
```

### `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetup.ts`

أضف `ChatSetupStrategy.SetupWithCursor = 7`.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/src/vs/workbench/contrib/chat/browser/chatSetup/chatSetup.ts b/src/vs/workbench/contrib/chat/browser/chatSetup/chatSetup.ts
index 47c0175a..68f13f0f 100644
--- a/src/vs/workbench/contrib/chat/browser/chatSetup/chatSetup.ts
+++ b/src/vs/workbench/contrib/chat/browser/chatSetup/chatSetup.ts
@@ -57,7 +57,9 @@ export enum ChatSetupStrategy {
 	SetupWithEnterpriseProvider = 3,
 	SetupWithGoogleProvider = 4,
 	SetupWithAppleProvider = 5,
-	SetupWithMicrosoftProvider = 6
+	SetupWithMicrosoftProvider = 6,
+	/** End-user Cursor account (`agent login`), not a Copilot identity provider. */
+	SetupWithCursor = 7
 }
 
 export type ChatSetupResultValue = boolean /* success */ | undefined /* canceled */;
```

### `src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupRunner.ts`

أضف زر «Continue with Cursor» بعد Apple، وحالة في switch تشغّل `axiora.cursor.signIn` دون اعتبار إعداد Copilot مكتملاً.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupRunner.ts b/src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupRunner.ts
index d27f610f..10f2bfc3 100644
--- a/src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupRunner.ts
+++ b/src/vs/workbench/contrib/chat/browser/chatSetup/chatSetupRunner.ts
@@ -264,9 +264,10 @@ export function getChatSetupDialogButtons(entitlement: ChatEntitlement, options:
 		const enterpriseProviderLink = button(enterpriseProviderButton.label, enterpriseProviderButton.strategy, 'link-button');
 		const googleProviderButton = button(localize('continueWith', "Continue with {0}", providers.google.name), ChatSetupStrategy.SetupWithGoogleProvider, 'continue-button', 'google');
 		const appleProviderButton = button(localize('continueWith', "Continue with {0}", providers.apple.name), ChatSetupStrategy.SetupWithAppleProvider, 'continue-button', 'apple');
+		const cursorProviderButton = button(localize('continueWithCursor', "Continue with Cursor"), ChatSetupStrategy.SetupWithCursor, 'continue-button', 'cursor');
 		const microsoftProviderButton = button(localize('continueWith', "Continue with {0}", providers.microsoft.name), ChatSetupStrategy.SetupWithMicrosoftProvider, 'continue-button', 'microsoft');
 
-		const socialProviderButtons = [googleProviderButton, appleProviderButton, ...(showMicrosoftProvider ? [microsoftProviderButton] : [])];
+		const socialProviderButtons = [googleProviderButton, appleProviderButton, cursorProviderButton, ...(showMicrosoftProvider ? [microsoftProviderButton] : [])];
 		const providerButtons = enterpriseAuthentication
 			? [enterpriseProviderButton, ...socialProviderButtons, defaultProviderLink]
 			: [defaultProviderButton, ...socialProviderButtons, enterpriseProviderLink];
@@ -429,6 +430,12 @@ export class ChatSetup {
 				case ChatSetupStrategy.SetupWithMicrosoftProvider:
 					success = await this.controller.value.setupWithProvider({ useEnterpriseProvider: false, useSocialProvider: 'microsoft', additionalScopes: options?.additionalScopes, forceAnonymous: options?.forceAnonymous, cancellationToken: setupCancellation.token });
 					break;
+				case ChatSetupStrategy.SetupWithCursor:
+					// Cursor is the end user's own account via the CLI, not a Copilot provider.
+					// Leave Copilot setup incomplete (`success` stays unset) so this choice does not
+					// mark GitHub Copilot as signed in.
+					await this.commandService.executeCommand('axiora.cursor.signIn');
+					break;
 				case ChatSetupStrategy.DefaultSetup:
 					success = await this.controller.value.setup({ ...options, useEnterpriseProvider: signedInAccount?.authenticationProvider.enterprise, forceAnonymous: options?.forceAnonymous, cancellationToken: setupCancellation.token });
 					break;
```

### `src/vs/workbench/contrib/chat/browser/chatSetup/media/chatSetup.css`

أخفِ مربع الأيقونة الفارغ على زر Cursor.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/src/vs/workbench/contrib/chat/browser/chatSetup/media/chatSetup.css b/src/vs/workbench/contrib/chat/browser/chatSetup/media/chatSetup.css
index 334d9f5d..cd5db748 100644
--- a/src/vs/workbench/contrib/chat/browser/chatSetup/media/chatSetup.css
+++ b/src/vs/workbench/contrib/chat/browser/chatSetup/media/chatSetup.css
@@ -27,6 +27,13 @@
 		background-image: url('./google.svg');
 	}
 
+	/* Text-only: Cursor has no bundled mark. An empty ::before would reserve a blank icon. */
+	.dialog-buttons-row > .dialog-buttons > .monaco-button.continue-button.cursor::before {
+		background-image: none;
+		width: 0;
+		padding-right: 0;
+	}
+
 	/* Link Buttons */
 
 	.dialog-buttons-row > .dialog-buttons > .monaco-button.link-button {
```

### `src/vs/workbench/contrib/chat/test/browser/chatSetup/chatSetup.test.ts`

توقع ظهور Continue with Cursor في ترتيب أزرار الحوار.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/src/vs/workbench/contrib/chat/test/browser/chatSetup/chatSetup.test.ts b/src/vs/workbench/contrib/chat/test/browser/chatSetup/chatSetup.test.ts
index 2c9786c7..4936ec94 100644
--- a/src/vs/workbench/contrib/chat/test/browser/chatSetup/chatSetup.test.ts
+++ b/src/vs/workbench/contrib/chat/test/browser/chatSetup/chatSetup.test.ts
@@ -144,7 +144,7 @@ suite('Chat setup dialog presentation', () => {
 			lastButton: buttons.at(-1),
 			footer,
 		}, {
-			buttonLabels: ['Continue with GitHub', 'Continue with Google', 'Continue with Apple', 'Continue with GHE', 'Continue Without Signing In'],
+			buttonLabels: ['Continue with GitHub', 'Continue with Google', 'Continue with Apple', 'Continue with Cursor', 'Continue with GHE', 'Continue Without Signing In'],
 			lastButton: {
 				label: 'Continue Without Signing In',
 				strategy: ChatSetupStrategy.Canceled,
@@ -173,9 +173,9 @@ suite('Chat setup dialog presentation', () => {
 			// every one of them signs in against whichever host the default account points at.
 			enterprise: buttonLabels({}, true, true),
 		}, {
-			withMicrosoft: ['Continue with GitHub', 'Continue with Google', 'Continue with Apple', 'Continue with Microsoft', 'Continue with GHE', 'Continue Without Signing In'],
-			withoutMicrosoft: ['Continue with GitHub', 'Continue with Google', 'Continue with Apple', 'Continue with GHE', 'Continue Without Signing In'],
-			enterprise: ['Continue with GHE', 'Continue with Google', 'Continue with Apple', 'Continue with Microsoft', 'Continue with GitHub'],
+			withMicrosoft: ['Continue with GitHub', 'Continue with Google', 'Continue with Apple', 'Continue with Cursor', 'Continue with Microsoft', 'Continue with GHE', 'Continue Without Signing In'],
+			withoutMicrosoft: ['Continue with GitHub', 'Continue with Google', 'Continue with Apple', 'Continue with Cursor', 'Continue with GHE', 'Continue Without Signing In'],
+			enterprise: ['Continue with GHE', 'Continue with Google', 'Continue with Apple', 'Continue with Cursor', 'Continue with Microsoft', 'Continue with GitHub'],
 		});
 	});
```

### `src/vs/workbench/contrib/preferences/browser/axioraSettingLabels.ts`

تسميات `axiora.cursor.enabled` و `axiora.cursor.cliPath`.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/src/vs/workbench/contrib/preferences/browser/axioraSettingLabels.ts b/src/vs/workbench/contrib/preferences/browser/axioraSettingLabels.ts
index 47a0aa4d..44b2841c 100644
--- a/src/vs/workbench/contrib/preferences/browser/axioraSettingLabels.ts
+++ b/src/vs/workbench/contrib/preferences/browser/axioraSettingLabels.ts
@@ -102,6 +102,8 @@ export const axioraSettingLabels: { readonly [key: string]: { readonly category:
 	'axiora.share.endpoint': { category: localize('axiora.cat.RemoteandSharing', "Remote and Sharing"), label: localize('axiora.label.axiora.share.endpoint', "Share Server") },
 	'axiora.embed.baseUrl': { category: localize('axiora.cat.RemoteandSharing', "Remote and Sharing"), label: localize('axiora.label.axiora.embed.baseUrl', "Embed Base URL") },
 	'axiora.acp.agents': { category: localize('axiora.cat.RemoteandSharing', "Remote and Sharing"), label: localize('axiora.label.axiora.acp.agents', "ACP Agents") },
+	'axiora.cursor.enabled': { category: localize('axiora.cat.Cursor', "Cursor"), label: localize('axiora.label.axiora.cursor.enabled', "Enabled") },
+	'axiora.cursor.cliPath': { category: localize('axiora.cat.Cursor', "Cursor"), label: localize('axiora.label.axiora.cursor.cliPath', "CLI Path") },
 	'axiora.language.display': { category: "", label: localize('axiora.label.axiora.language.display', "Display Language") },
 	'axiora.language.mirrorLayout': { category: "", label: localize('axiora.label.axiora.language.mirrorLayout', "Right-to-Left Layout for Arabic") },
 	'axiora.language.statusBar': { category: "", label: localize('axiora.label.axiora.language.statusBar', "Language Switch in Status Bar") },
```

### `src/vs/workbench/contrib/preferences/browser/settingsLayout.ts`

أضف مجموعة Cursor تحت تكاملات Axiora.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/src/vs/workbench/contrib/preferences/browser/settingsLayout.ts b/src/vs/workbench/contrib/preferences/browser/settingsLayout.ts
index 5d7784e2..e0cae162 100644
--- a/src/vs/workbench/contrib/preferences/browser/settingsLayout.ts
+++ b/src/vs/workbench/contrib/preferences/browser/settingsLayout.ts
@@ -425,6 +425,11 @@ export const tocData: ITOCEntry<string> = {
 					label: localize('axiora.toc.integrations.remote', "Remote and Sharing"),
 					settings: ['axiora.runner.machines', 'axiora.collab.relayUrl', 'axiora.share.endpoint', 'axiora.embed.baseUrl', 'axiora.acp.agents']
 				},
+				{
+					id: 'integrations/cursor',
+					label: localize('axiora.toc.integrations.cursor', "Cursor"),
+					settings: ['axiora.cursor.enabled', 'axiora.cursor.cliPath']
+				},
 			]
 		},
 		{
```

### `src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts`

بطاقة في ترويسة صفحة الترحيب تشغّل `axiora.cursor.signIn`.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts b/src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts
index a071cc44..96d41113 100644
--- a/src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts
+++ b/src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts
@@ -952,6 +952,17 @@ export class GettingStartedPage extends EditorPane {
 		header.appendChild(aiCard);
 		this.categoriesSlideDisposables.add(this.contextService.onDidChangeContext(e => { if (e.affectsSome(new Set(['axiora.aiReady', 'axiora.aiProviderLabel']))) { renderAiCard(); } }));
 
+		// Cursor tool card on the Welcome page. Same sign-in as the Setup walkthrough card next to Copilot.
+		const cursorCard = $('.axiora-ai-card.axiora-cursor-card');
+		const cursorSignIn = $('button.axiora-ai-card-button', {}, localize('axiora.welcome.cursor.signIn', "Sign in with Cursor"));
+		this.categoriesSlideDisposables.add(addDisposableListener(cursorSignIn, 'click', () => this.commandService.executeCommand('axiora.cursor.signIn')));
+		reset(cursorCard,
+			$('div.axiora-ai-card-text', {},
+				$('span.axiora-ai-card-title', {}, localize('axiora.welcome.cursor.title', "Cursor")),
+				$('span.axiora-ai-card-detail', {}, localize('axiora.welcome.cursor.detail', "Sign in with your Cursor account. The agent runs inside the editor."))),
+			$('div.axiora-ai-card-actions', {}, cursorSignIn));
+		header.appendChild(cursorCard);
+
 		const leftColumn = $('.categories-column.categories-column-left', {},);
 		const rightColumn = $('.categories-column.categories-column-right', {},);
```

### `src/vs/workbench/contrib/welcomeGettingStarted/browser/media/gettingStarted.css`

مسافة لبطاقة Cursor في صفحة الترحيب.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/src/vs/workbench/contrib/welcomeGettingStarted/browser/media/gettingStarted.css b/src/vs/workbench/contrib/welcomeGettingStarted/browser/media/gettingStarted.css
index b6dce7ae..70ecd615 100644
--- a/src/vs/workbench/contrib/welcomeGettingStarted/browser/media/gettingStarted.css
+++ b/src/vs/workbench/contrib/welcomeGettingStarted/browser/media/gettingStarted.css
@@ -1157,3 +1157,4 @@
 .monaco-workbench .part.editor > .content .gettingStartedContainer .axiora-ai-card .axiora-ai-card-button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 5px 14px; cursor: pointer; font-family: inherit; }
 .monaco-workbench .part.editor > .content .gettingStartedContainer .axiora-ai-card .axiora-ai-card-button:hover { background: var(--vscode-button-hoverBackground); }
 .monaco-workbench .part.editor > .content .gettingStartedContainer .axiora-ai-card .axiora-ai-card-link { color: var(--vscode-textLink-foreground); }
+.monaco-workbench .part.editor > .content .gettingStartedContainer .axiora-cursor-card { margin-top: 8px; }
```

### `src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts`

خطوة جولة الإعداد `CursorAgent` مباشرة بعد خطوات Copilot.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts b/src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts
index 51bee8ae..e248c2fa 100644
--- a/src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts
+++ b/src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts
@@ -266,6 +266,13 @@ export const walkthroughs: GettingStartedWalkthroughContent = [
 				createCopilotSetupStep('CopilotSetupSignedOut', CopilotSignedOutButton, 'chatEntitlementSignedOut && !chatAnonymous && !github.copilot.hasByokModels', false),
 				createCopilotSetupStep('CopilotSetupComplete', CopilotCompleteButton, 'chatSetupCompleted && !chatSetupDisabled && (chatAnonymous || chatPlanPro || chatPlanProPlus || chatPlanMax || chatPlanBusiness || chatPlanEnterprise || chatPlanFree)', false),
 				createCopilotSetupStep('CopilotSetupSignedIn', CopilotSignedInButton, '!chatEntitlementSignedOut && (!chatSetupCompleted || chatSetupDisabled || chatPlanCanSignUp)', false),
+				{
+					id: 'CursorAgent',
+					title: localize('gettingStarted.cursorAgent.title', "Use Cursor Agent"),
+					description: localize('gettingStarted.cursorAgent.description', "Sign in with your Cursor account and run the Cursor agent inside the editor. Axiora downloads the official Cursor CLI for you.\n{0}", Button(localize('gettingStarted.cursorAgent.signIn', "Sign in with Cursor"), 'command:axiora.cursor.signIn')),
+					when: '!isWeb',
+					media: { type: 'svg', altText: 'Cursor Agent', path: 'multi-file-edits.svg' },
+				},
 				{
 					id: 'pickColorTheme',
 					title: localize('gettingStarted.pickColor.title', "Choose your theme"),
```

### `src/vs/workbench/contrib/welcomeOnboarding/browser/media/variationA.css`

تنسيق علامة الزر لموفّر Cursor.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/src/vs/workbench/contrib/welcomeOnboarding/browser/media/variationA.css b/src/vs/workbench/contrib/welcomeOnboarding/browser/media/variationA.css
index e3b521c8..bf30a2d3 100644
--- a/src/vs/workbench/contrib/welcomeOnboarding/browser/media/variationA.css
+++ b/src/vs/workbench/contrib/welcomeOnboarding/browser/media/variationA.css
@@ -532,6 +532,15 @@
 	color: currentColor;
 }
 
+.onboarding-a-provider-mark.cursor {
+	background-image: none;
+}
+
+.onboarding-a-provider-mark.cursor .codicon {
+	font-size: 16px;
+	color: currentColor;
+}
+
 .onboarding-a-provider-mark.google {
 	background-image: url('../../../chat/browser/chatSetup/media/google.svg');
 }
```

### `src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts`

زر Continue with Cursor يشغّل `axiora.cursor.signIn` ولا يستدعي مسار Copilot `_handleSignIn`.

الأسطر التي تبدأ بـ `-` هي المرساة الموجودة في ملفك. الأسطر التي تبدأ بـ `+` هي ما تضيفه أو تستبدله. أسطر السياق (بلا بادئة داخل المقطع، وتظهر هنا بمسافة في البداية) يجب أن تطابق الملف كما هو.

```diff
diff --git a/src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts b/src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts
index f8346061..1817dc57 100644
--- a/src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts
+++ b/src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts
@@ -581,6 +581,14 @@ export class OnboardingVariationA extends Disposable implements IOnboardingServi
 			this._handleSignIn('apple');
 		}));
 
+		const cursorBtn = this._registerStepFocusable(this._createSignInButton(actions, 'cursor', localize('onboarding.signIn.cursor', "Continue with Cursor"), {
+			label: localize('onboarding.signIn.cursor.aria', "Continue with Cursor")
+		}));
+		this.stepDisposables.add(addDisposableListener(cursorBtn, EventType.CLICK, () => {
+			this._logAction('signIn', undefined, 'cursor');
+			void this.commandService.executeCommand('axiora.cursor.signIn');
+		}));
+
 		const microsoftBtn = this._registerStepFocusable(this._createSignInButton(actions, 'microsoft', localize('onboarding.signIn.microsoft', "Continue with Microsoft"), {
 			iconOnly: true,
 			label: localize('onboarding.signIn.microsoft', "Continue with Microsoft")
@@ -718,7 +726,7 @@ export class OnboardingVariationA extends Disposable implements IOnboardingServi
 		}
 	}
 
-	private _createSignInButton(parent: HTMLElement, providerClass: 'github' | 'github-enterprise' | 'google' | 'apple' | 'microsoft', label: string, options?: { emphasized?: boolean; iconOnly?: boolean; textOnly?: boolean; label?: string }): HTMLButtonElement {
+	private _createSignInButton(parent: HTMLElement, providerClass: 'github' | 'github-enterprise' | 'google' | 'apple' | 'microsoft' | 'cursor', label: string, options?: { emphasized?: boolean; iconOnly?: boolean; textOnly?: boolean; label?: string }): HTMLButtonElement {
 		const isCompact = options?.iconOnly || options?.textOnly;
 		const btn = append(parent, $<HTMLButtonElement>(isCompact ? 'button.onboarding-a-signin-icon-btn' : 'button.onboarding-a-signin-btn'));
 		btn.type = 'button';
@@ -734,6 +742,8 @@ export class OnboardingVariationA extends Disposable implements IOnboardingServi
 			mark.setAttribute('aria-hidden', 'true');
 			if (providerClass === 'github' || providerClass === 'github-enterprise') {
 				mark.appendChild(renderIcon(Codicon.github));
+			} else if (providerClass === 'cursor') {
+				mark.appendChild(renderIcon(Codicon.sparkle));
 			}
 		}
```

## الدوال والأوامر والإعدادات المضافة

انظر `MANIFEST.json`.

## التحقق

```bash
node --experimental-strip-types --test extensions/axiora-local-ai/test/cursorIntegration.test.ts
```

مجموعة اختبارات إعداد الدردشة في واجهة العمل (`src/vs/workbench/contrib/chat/test/browser/chatSetup/chatSetup.test.ts`) تحتاج بيئة اختبار Electron الكاملة. هذه الإضافة تحدّث فقط تسميات الأزرار المتوقعة في ذلك الملف.

## السلوك المتوقع

- التخزين: التخزين العام للإضافة `cursor-cli/current.json` و `cursor-cli/versions/<version>/<target>/.complete`.
- أمر الدخول: `axiora.cursor.signIn` يشغّل `agent login` مع `NO_OPEN_BROWSER=1` ويفتح أول عنوان `https://`. ثم `agent status`. مفتاح السياق `axiora.cursor.signedIn`.
- اختيار Cursor في حوار تسجيل دخول Copilot **لا** يُعلّم إعداد Copilot كمكتمل (`success` يبقى غير معيَّن). إذا فُتح الحوار من وكيل الإعداد داخل الدردشة، الكود القائم يعامل النتيجة غير المعيَّنة كإلغاء وقد يُظهر رسالة الحاجة إلى الإعداد. الإضافة تعرض مع ذلك إشعارها «Signed in to Cursor.».
- إدخال في `axiora.acp.agents` اسمه `cursor` يحل محل الوكيل المدمج. الوكلاء الآخرون يتلقون `authenticate` فقط عندما يعلنون `authMethods`.
- التنزيل الحي، و `agent login` الحي، وجلسة ACP الحية تحتاج حساب Cursor وشبكة. اختبارات الوحدة لا تغطيها.
