/*---------------------------------------------------------------------------------------------
 *  Axiora: Settings › Language (section 12). One switch between English (default) and Arabic.
 *  - `axiora.language.display` writes `locale` to argv.json through ILocaleService and restarts.
 *  - When Arabic is active the workbench is mirrored right-to-left (`axiora-rtl` class + dir=rtl),
 *    the side bar moves to the right, and code editors stay left-to-right.
 *  - Command palette: "Axiora: Switch Display Language"; status bar: globe entry.
 *--------------------------------------------------------------------------------------------*/

import './media/axioraRtl.css';
import { localize, localize2 } from '../../../../nls.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { language } from '../../../../base/common/platform.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILocaleService } from '../../../services/localization/common/locale.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';

export const AXIORA_LANGUAGE_SETTING = 'axiora.language.display';
export const AXIORA_MIRROR_SETTING = 'axiora.language.mirrorLayout';
export const AXIORA_LANGUAGE_STATUS_SETTING = 'axiora.language.statusBar';

type UiLanguage = 'en' | 'ar';
const currentUiLanguage = (): UiLanguage => language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
const isArabicUi = currentUiLanguage() === 'ar';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'axiora.language',
	order: 200,
	title: localize('axiora.language.title', "Language"),
	type: 'object',
	properties: {
		[AXIORA_LANGUAGE_SETTING]: {
			type: 'string',
			enum: ['en', 'ar'],
			enumItemLabels: ['English', 'العربية'],
			enumDescriptions: [
				localize('axiora.language.display.en', "Show the whole app in English, laid out left-to-right (default)."),
				localize('axiora.language.display.ar', "Show the whole app in Arabic, laid out right-to-left. Code stays left-to-right."),
			],
			default: 'en',
			scope: ConfigurationScope.APPLICATION,
			order: 1,
			markdownDescription: localize('axiora.language.display', "Display language of Axiora Code — every menu, title, setting, message, command and Axiora feature. Changing it restarts the app. Code, identifiers and file contents are never translated."),
		},
		[AXIORA_MIRROR_SETTING]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			order: 2,
			markdownDescription: localize('axiora.language.mirrorLayout', "When the display language is Arabic, mirror the layout right-to-left: activity bar and side bar on the right, menus, lists, settings, dialogs, panels and chat flow from the right. Code editors and terminals stay left-to-right."),
		},
		[AXIORA_LANGUAGE_STATUS_SETTING]: {
			type: 'boolean',
			default: true,
			order: 3,
			markdownDescription: localize('axiora.language.statusBar', "Show the display language switch (EN / ع) in the status bar."),
		},
	}
});

// Arabic: side bar (and activity bar) on the right by default; the secondary side bar moves to the left.
if (isArabicUi) {
	Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{ overrides: { 'workbench.sideBar.location': 'right' } }]);
}

async function switchLanguage(configurationService: IConfigurationService, localeService: ILocaleService, target: UiLanguage): Promise<void> {
	if (configurationService.getValue<string>(AXIORA_LANGUAGE_SETTING) !== target) {
		await configurationService.updateValue(AXIORA_LANGUAGE_SETTING, target, ConfigurationTarget.USER);
	} else if (target !== currentUiLanguage()) {
		await applyLocale(localeService, target);
	}
}

function applyLocale(localeService: ILocaleService, target: UiLanguage): Promise<void> {
	return localeService.setLocale(target === 'ar'
		? { id: 'ar', label: 'العربية', extensionId: 'axiora.axiora-language-pack-ar' }
		: { id: 'en', label: 'English' }, true);
}

class AxioraLanguageContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.axioraLanguage';
	private readonly status = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILocaleService private readonly localeService: ILocaleService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@ILayoutService private readonly layoutService: ILayoutService,
	) {
		super();

		// Keep the setting in sync with the language the app actually started in
		// (e.g. after "Configure Display Language" or editing argv.json by hand).
		const actual = currentUiLanguage();
		if (this.configurationService.getValue<string>(AXIORA_LANGUAGE_SETTING) !== actual) {
			this.configurationService.updateValue(AXIORA_LANGUAGE_SETTING, actual, ConfigurationTarget.USER);
		}

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AXIORA_LANGUAGE_SETTING)) {
				const wanted = this.configurationService.getValue<string>(AXIORA_LANGUAGE_SETTING) === 'ar' ? 'ar' : 'en';
				if (wanted !== currentUiLanguage()) {
					applyLocale(this.localeService, wanted);
				}
			}
			if (e.affectsConfiguration(AXIORA_MIRROR_SETTING)) { this.applyDirection(); }
			if (e.affectsConfiguration(AXIORA_LANGUAGE_STATUS_SETTING)) { this.updateStatus(); }
		}));

		this.applyDirection();
		this._register(this.layoutService.onDidAddContainer(({ container, disposables }) => {
			this.applyDirectionTo(container);
			disposables.add({ dispose: () => container.classList.remove('axiora-rtl') });
		}));
		this.updateStatus();
	}

	private get rtl(): boolean {
		return isArabicUi && this.configurationService.getValue<boolean>(AXIORA_MIRROR_SETTING) !== false;
	}

	private applyDirection(): void {
		for (const container of this.layoutService.containers) { this.applyDirectionTo(container); }
		const doc = this.layoutService.mainContainer.ownerDocument;
		doc.documentElement.lang = isArabicUi ? 'ar' : 'en';
		doc.documentElement.dir = this.rtl ? 'rtl' : 'ltr';
	}

	private applyDirectionTo(container: HTMLElement): void {
		container.classList.toggle('axiora-rtl', this.rtl);
		container.dir = this.rtl ? 'rtl' : 'ltr';
	}

	private updateStatus(): void {
		if (this.configurationService.getValue<boolean>(AXIORA_LANGUAGE_STATUS_SETTING) === false) {
			this.status.clear();
			return;
		}
		const entry = {
			name: localize('axiora.language.status.name', "Display Language"),
			text: isArabicUi ? '$(globe) ع' : '$(globe) EN',
			ariaLabel: localize('axiora.language.status.aria', "Display language: {0}. Click to switch.", isArabicUi ? 'العربية' : 'English'),
			tooltip: localize('axiora.language.status.tooltip', "Display language: {0} — click to switch between English and العربية", isArabicUi ? 'العربية' : 'English'),
			command: 'axiora.language.choose',
		};
		if (this.status.value) { this.status.value.update(entry); }
		else { this.status.value = this.statusbarService.addEntry(entry, 'axiora.language.status', StatusbarAlignment.RIGHT, 1001); }
	}
}

registerWorkbenchContribution2(AxioraLanguageContribution.ID, AxioraLanguageContribution, WorkbenchPhase.BlockRestore);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'axiora.language.choose',
			title: localize2('axiora.language.choose', "Switch Display Language (English / العربية)..."),
			category: localize2('axiora.category', "Axiora"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const configurationService = accessor.get(IConfigurationService);
		const localeService = accessor.get(ILocaleService);
		const current = currentUiLanguage();
		const items = [
			{ id: 'en' as UiLanguage, label: 'English', description: current === 'en' ? localize('axiora.language.current', "Current") : undefined, detail: localize('axiora.language.detail.en', "Left-to-right") },
			{ id: 'ar' as UiLanguage, label: 'العربية', description: current === 'ar' ? localize('axiora.language.current', "Current") : undefined, detail: localize('axiora.language.detail.ar', "Right-to-left — يبدأ من اليمين") },
		];
		const pick = await quickInputService.pick(items, { placeHolder: localize('axiora.language.pick', "Choose the display language (the app restarts)"), activeItem: items.find(i => i.id === current) });
		if (pick) { await switchLanguage(configurationService, localeService, pick.id); }
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'axiora.language.toggle',
			title: localize2('axiora.language.toggle', "Toggle Display Language (English ⇄ العربية)"),
			category: localize2('axiora.category', "Axiora"),
			f1: true,
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		return switchLanguage(accessor.get(IConfigurationService), accessor.get(ILocaleService), currentUiLanguage() === 'ar' ? 'en' : 'ar');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'axiora.language.openSettings',
			title: localize2('axiora.language.openSettings', "Open Language Settings"),
			category: localize2('axiora.category', "Axiora"),
			f1: true,
			menu: { id: MenuId.MenubarPreferencesMenu, group: '1_settings', order: 3 },
		});
	}
	run(accessor: ServicesAccessor): Promise<unknown> {
		return accessor.get(IPreferencesService).openSettings({ query: '@id:axiora.language.display @id:axiora.language.mirrorLayout @id:axiora.language.statusBar @id:axiora.chat.responseLanguage @id:axiora.voice.language' });
	}
});

