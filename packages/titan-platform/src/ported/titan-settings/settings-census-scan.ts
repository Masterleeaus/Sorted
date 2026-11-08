// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-settings/settings-census-scan.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const content = read('content.js');
const monicaHtml = read('monicaOptions.html');
const titanHtml = read('titan-zero-options.html');
const titanTheme = read('titan-theme.js');
const retrieverStoragePath = fs.readdirSync(path.join(root, 'side-panel/assets')).find(name => name.startsWith('storageUtils-') && name.endsWith('.js'));
const retrieverUserSettingsPath = fs.readdirSync(path.join(root, 'side-panel/assets')).find(name => name.startsWith('userSettingsService-') && name.endsWith('.js'));
const retrieverLlmConfigPath = fs.readdirSync(path.join(root, 'side-panel/assets')).find(name => name.startsWith('llmConfigService-') && name.endsWith('.js'));
const retrieverStorage = read(`side-panel/assets/${retrieverStoragePath}`);
const retrieverUserSettings = read(`side-panel/assets/${retrieverUserSettingsPath}`);
const retrieverLlmConfig = read(`side-panel/assets/${retrieverLlmConfigPath}`);

const families = [
  { id: 'general_language', title: 'General, locale and language', evidence: ['mainSettings','monicaSetting','currentLocaleSetting','defaultLocaleSetting','LanguageSetting','MultipleLangSetting'] },
  { id: 'writing_grammar', title: 'Writing assistant and grammar', evidence: ['monicaWriting','activeWriting','defaultWritingTone','grammar-setting','GrammarLanguageSetting','mail_writing_assistant_switch','social_media_writing_assistant_switch'] },
  { id: 'search_research', title: 'Search and research', evidence: ['MonicaSearchEnhance','search-enhance-settings','SearchEnhanceModelSwitch','showTrendingSearches','showMonicaSearchTips','expandSearchEnable','deepSearchEnable','finalSearchRespondLanguage','onlyShowSearchWeb'] },
  { id: 'translation', title: 'Translation', evidence: ['translateSettingEnable','translateSettingList','translateSettingOpen','translateShortcutSettingList','translateStyleSettingList','webTranslationSettingOpen','webpageTranslationEngineList','parallelTranslation','finalTranslationTargetRespondLanguage'] },
  { id: 'sidebar_floating', title: 'Sidebar and floating assistant', evidence: ['globalSidebar','desktopSidebarGuideShowed','extension_sidebar','finalSidebarDisplayPosition','finalSidebarEntryBtnPosition','finalSidebarPin','finalSidebarWindowPin','MonicaFloatingIcon','hoverSidebar'] },
  { id: 'text_selection', title: 'Text selection and contextual tools', evidence: ['TextSelectionToolPage','textSelectionTool','contextualToolbarTriggerShortcut','contextualToolbarImageToolTriggerShortcut','paste-selection-button'] },
  { id: 'keyboard_shortcuts', title: 'Keyboard shortcuts', evidence: ['KeyboardShortcutsPage','keyboardShortcutMap','openChatTabPageKeyboardShortcut','softKeyboardShortcutsEnabled','menuShortcut'] },
  { id: 'models_providers', title: 'Models and providers', evidence: ['ChatModelSwitch','CompareModelsPopover','selectedModel','quickActionSelectedModel','quickAskSelectedModel','defaultMonicaModel','renderProvider','advanceModels'] },
  { id: 'chat_behavior', title: 'Chat behaviour and research controls', evidence: ['ChatSetting','chatInputSetting','chatExpandResearchEnable','chatSkillResearchEnable','chatSkillWritingHeaderClosed','compareModelEnableOption','deepResearch'] },
  { id: 'reading', title: 'Reading assistance', evidence: ['ReadingSetting','readingPageSettingOpen','readingSetting'] },
  { id: 'image', title: 'Image tools and image translation', evidence: ['imageSettings','imageTranslationButtonVisible','imageTranslationLang','imageModelConfig','imageModelConfigOptions'] },
  { id: 'video', title: 'Video model controls', evidence: ['videoModelConfig','videoModelConfigOptions','defaultVideoModelType'] },
  { id: 'audio_podcast_voice', title: 'Audio, podcast and voice controls', evidence: ['PodcastSetting','podcastSettingOpen','voiceModelVisible','audioToTextContinueInChatData'] },
  { id: 'pdf_documents', title: 'PDF and document controls', evidence: ['chat-pdfsetting','chatPdfTranslationEngine','doc-chat-sidebar-collapsed','pdfTranslation','pdf_translation'] },
  { id: 'account_preferences', title: 'Account and preferences', evidence: ['PreferencesSettings','ConnectionSettings','LicensingSettings','monica-team-enabled'] }
].map(family => ({
  ...family,
  matches: family.evidence.filter(token => content.includes(token)),
  missing_evidence: family.evidence.filter(token => !content.includes(token))
}));

const titanControls = [...titanHtml.matchAll(/data-titan-([a-z0-9-]+)/gi)].map(m => `data-titan-${m[1]}`);
const titanUniqueControls = [...new Set(titanControls)].sort();
const titanThemeStorage = [...titanTheme.matchAll(/const\s+(?:STORAGE_KEY|THEME_CONFIG_KEY)\s*=\s*'([^']+)'/g)].map(m => m[1]);
const themeModesMatch = titanTheme.match(/THEME_MODES\s*=\s*Object\.freeze\(\[([^\]]+)\]\)/);
const themeModes = themeModesMatch ? [...themeModesMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];

const retrieverKeyObjectMatch = retrieverStorage.match(/const\s+v=\{(.+?)\},L=/s);
const retrieverKeys = [];
if (retrieverKeyObjectMatch) {
  for (const match of retrieverKeyObjectMatch[1].matchAll(/([A-Z0-9_]+):"([^"]+)"/g)) {
    retrieverKeys.push({ constant: match[1], key: match[2] });
  }
}
const writableLabels = [...retrieverUserSettings.matchAll(/key:"([^"]+)"[^}]*?label:"([^"]+)"/g)].map(m => ({ key: m[1], label: m[2] }));
const explicitWritableKeys = [...new Set([...retrieverUserSettings.matchAll(/a\("([^"]+)","([^"]+)"/g)].map(m => m[1]))];
const llmKeys = ['freeModeEnabled','freeModeChoiceMade','privateMode','geminiApiKey','geminiApiKeys','geminiApiKeyEnabled','providerConfigs','chatOptions'].filter(k => retrieverLlmConfig.includes(k));

const candidateRegex = /"([A-Za-z0-9_.:-]{3,100}(?:setting|settings|sidebar|translation|writing|selection|shortcut|model|provider|search)[A-Za-z0-9_.:-]{0,100})"/gi;
const candidates = new Set();
for (const m of content.matchAll(candidateRegex)) {
  const value = m[1];
  if (/^(?:https?|www\.)/i.test(value)) continue;
  if (/^(?:org\.eclipse|gc-|editor\.|list\.|terminal\.|targetNode\.|react\.)/i.test(value)) continue;
  if (/Model(?:Q|Fit|Data|Policy|Strategy|Controller|Decomposition|Order|Simulate|Plot|Measurements|Reliability|Space|Linearize|Dimensions|Delete|Merge|Delay)/.test(value)) continue;
  candidates.add(value);
}

const result = {
  schema: 'titan-zero-settings-census/v1',
  packet_id: 'TZ-SETTINGS-THEME-RESTORE-001',
  pass: 1,
  sources: {
    monica_options_host: 'monicaOptions.html',
    monica_runtime: 'content.js',
    titan_options: 'titan-zero-options.html',
    titan_theme_runtime: 'titan-theme.js',
    retriever_storage: `side-panel/assets/${retrieverStoragePath}`,
    retriever_user_settings: `side-panel/assets/${retrieverUserSettingsPath}`,
    retriever_llm_config: `side-panel/assets/${retrieverLlmConfigPath}`
  },
  architecture: {
    monica_options_host_has_root: monicaHtml.includes('id="root"'),
    monica_options_loads_content_runtime: monicaHtml.includes('./content.js'),
    titan_options_has_separate_root: titanHtml.includes('id="root"'),
    current_setting_authorities: ['monica-rich-runtime','titan-theme-launcher-page','retriever-device-model-settings'],
    merge_required: true
  },
  monica_setting_families: families,
  monica_candidate_identifiers: [...candidates].sort(),
  titan: {
    controls: titanUniqueControls,
    theme_storage_keys: titanThemeStorage,
    theme_modes: themeModes,
    presets: [...titanHtml.matchAll(/data-titan-theme-preset="([^"]+)"/g)].map(m => m[1]),
    colour_controls: ['background','primary','secondary','tertiary'].filter(k => titanHtml.includes(`data-titan-theme-${k}`)),
    launcher_actions: [...titanHtml.matchAll(/data-titan-options-launch="([^"]+)"/g)].map(m => m[1])
  },
  retriever: {
    storage_keys: retrieverKeys,
    writable_labelled_settings: writableLabels,
    explicit_writable_keys: explicitWritableKeys,
    llm_configuration_keys: llmKeys,
    separate_theme_key: retrieverKeys.some(x => x.key === 'theme') ? 'theme' : null
  },
  conflicts_and_gaps: [
    {
      id: 'theme-key-split',
      severity: 'high',
      evidence: ['titanZeroTheme','titanZeroThemeConfig','theme'],
      finding: 'Titan and Retriever currently persist theme through different keys/contracts; later passes must converge propagation without losing existing state.'
    },
    {
      id: 'split-settings-authority',
      severity: 'high',
      evidence: ['monicaOptions.html','titan-zero-options.html','userSettingsService'],
      finding: 'Useful settings are split across three user-facing/runtime authorities and require one rich Titan Settings centre.'
    },
    {
      id: 'launcher-controls-in-settings',
      severity: 'medium',
      evidence: [...titanHtml.matchAll(/data-titan-options-launch="([^"]+)"/g)].map(m => m[1]),
      finding: 'The thin Titan settings page mixes navigation launchers into settings; preserve destinations but do not treat launchers as settings controls.'
    }
  ]
};

process.stdout.write(JSON.stringify(result, null, 2));
