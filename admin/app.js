const API_BASE = (globalThis.KAWANG_CONFIG?.apiUrl || "http://127.0.0.1:4300").replace(/\/+$/, "");
const API_BASE_CONFIGURED = Boolean(globalThis.KAWANG_CONFIG?.apiUrl);
const TOKEN_KEY = "kawang_admin_token";
const REFRESH_INTERVAL_MS = 5000;
const UPDATE_POLL_INTERVAL_MS = 3000;

const refs = {
  loginCard: document.querySelector("#login-card"),
  adminShell: document.querySelector("#admin-shell"),
  loginForm: document.querySelector("#login-form"),
  loginResult: document.querySelector("#login-result"),
  refreshBtn: document.querySelector("#refresh-btn"),
  logoutBtn: document.querySelector("#logout-btn"),
  sidebarVersion: document.querySelector("#sidebar-version"),
  sessionStatus: document.querySelector("#session-status"),
  stats: document.querySelector("#stats"),
  dashboardLogs: document.querySelector("#dashboard-logs"),
  siteResult: document.querySelector("#site-result"),
  siteList: document.querySelector("#site-list"),
  healthCheckAllBtn: document.querySelector("#health-check-all-btn"),
  singleCdkeyForm: document.querySelector("#single-cdkey-form"),
  singleCdkeyResult: document.querySelector("#single-cdkey-result"),
  batchForm: document.querySelector("#batch-form"),
  batchResult: document.querySelector("#batch-result"),
  batchList: document.querySelector("#batch-list"),
  cdkeyList: document.querySelector("#cdkey-list"),
  cdkeyAction: document.querySelector("#cdkey-action"),
  cdkeyActionBtn: document.querySelector("#cdkey-action-btn"),
  cdkeyExportPublicBtn: document.querySelector("#cdkey-export-public-btn"),
  cdkeyExportSourceBtn: document.querySelector("#cdkey-export-source-btn"),
  cdkeyExportExcelBtn: document.querySelector("#cdkey-export-excel-btn"),
  cdkeyFilterKeyword: document.querySelector("#cdkey-filter-keyword"),
  cdkeySearchBtn: document.querySelector("#cdkey-search-btn"),
  storeSettingsForm: document.querySelector("#store-settings-form"),
  storeBaseUrl: document.querySelector("#store-base-url"),
  storeAdminUsername: document.querySelector("#store-admin-username"),
  storeAdminPassword: document.querySelector("#store-admin-password"),
  storePollInterval: document.querySelector("#store-poll-interval"),
  storeEnabled: document.querySelector("#store-enabled"),
  storeTestBtn: document.querySelector("#store-test-btn"),
  storeSettingsStatus: document.querySelector("#store-settings-status"),
  storeSettingsResult: document.querySelector("#store-settings-result"),
  storeMappingForm: document.querySelector("#store-mapping-form"),
  storeMappingFormTitle: document.querySelector("#store-mapping-form-title"),
  storeMappingId: document.querySelector("#store-mapping-id"),
  storeProductId: document.querySelector("#store-product-id"),
  storeSkuId: document.querySelector("#store-sku-id"),
  storeProductTitle: document.querySelector("#store-product-title"),
  storeFulfillmentKind: document.querySelector("#store-fulfillment-kind"),
  storeSpaceXPlan: document.querySelector("#store-spacex-plan"),
  storeManualType: document.querySelector("#store-manual-type"),
  storeSiteId: document.querySelector("#store-site-id"),
  storePrefix: document.querySelector("#store-prefix"),
  storeMappingEnabled: document.querySelector("#store-mapping-enabled"),
  storeMappingCancelBtn: document.querySelector("#store-mapping-cancel-btn"),
  storeMappingResult: document.querySelector("#store-mapping-result"),
  storeMappingList: document.querySelector("#store-mapping-list"),
  storeMappingsRefreshBtn: document.querySelector("#store-mappings-refresh-btn"),
  storeTaskStatusFilter: document.querySelector("#store-task-status-filter"),
  storeTaskQuery: document.querySelector("#store-task-query"),
  storeTasksRefreshBtn: document.querySelector("#store-tasks-refresh-btn"),
  storeTaskListRefreshBtn: document.querySelector("#store-task-list-refresh-btn"),
  storeTaskList: document.querySelector("#store-task-list"),
  storeTaskResult: document.querySelector("#store-task-result"),
  spaceXCdkSettingsForm: document.querySelector("#spacex-cdk-settings-form"),
  spaceXCdkBaseUrl: document.querySelector("#spacex-cdk-base-url"),
  spaceXCdkApiKey: document.querySelector("#spacex-cdk-api-key"),
  spaceXCdkWebhookSecret: document.querySelector("#spacex-cdk-webhook-secret"),
  spaceXCdkRolloutPlan: document.querySelector("#spacex-cdk-rollout-plan"),
  spaceXCdkEnabled: document.querySelector("#spacex-cdk-enabled"),
  spaceXCdkUnlimitedFundingPolicy: document.querySelector("#spacex-cdk-unlimited-funding-policy"),
  spaceXCdkAdminUsername: document.querySelector("#spacex-cdk-admin-username"),
  spaceXCdkAdminPassword: document.querySelector("#spacex-cdk-admin-password"),
  spaceXCdkTestBtn: document.querySelector("#spacex-cdk-test-btn"),
  spaceXCdkSettingsStatus: document.querySelector("#spacex-cdk-settings-status"),
  spaceXCdkSettingsResult: document.querySelector("#spacex-cdk-settings-result"),
  spaceXCdkInventoryRefresh: document.querySelector("#spacex-cdk-inventory-refresh"),
  spaceXCdkInventoryList: document.querySelector("#spacex-cdk-inventory-list"),
  spaceXCdkActivationsRefresh: document.querySelector("#spacex-cdk-activations-refresh"),
  spaceXCdkActivationList: document.querySelector("#spacex-cdk-activation-list"),
  extensionDeliverySettingsForm: document.querySelector("#extension-delivery-settings-form"),
  extensionDeliveryEnabled: document.querySelector("#extension-delivery-enabled"),
  extensionDeliverySites: document.querySelector("#extension-delivery-sites"),
  extensionDeliveryConverterUrl: document.querySelector("#extension-delivery-converter-url"),
  extensionDeliverySpacexcardToken: document.querySelector("#extension-delivery-spacexcard-token"),
  extensionDeliveryClearSpacexcardToken: document.querySelector("#extension-delivery-clear-spacexcard-token"),
  extensionDeliverySettingsResult: document.querySelector("#extension-delivery-settings-result"),
  extensionDeliveryConnection: document.querySelector("#extension-delivery-connection"),
  extensionDeliveryGenerateToken: document.querySelector("#extension-delivery-generate-token"),
  extensionDeliveryResetToken: document.querySelector("#extension-delivery-reset-token"),
  extensionDeliveryRevokeToken: document.querySelector("#extension-delivery-revoke-token"),
  extensionDeliveryIssuedToken: document.querySelector("#extension-delivery-issued-token"),
  extensionDeliveryCopyToken: document.querySelector("#extension-delivery-copy-token"),
  extensionDeliveryResume: document.querySelector("#extension-delivery-resume"),
  extensionDeliveryRefresh: document.querySelector("#extension-delivery-refresh"),
  extensionDeliveryStatusFilter: document.querySelector("#extension-delivery-status-filter"),
  extensionDeliverySiteFilter: document.querySelector("#extension-delivery-site-filter"),
  extensionDeliveryQuery: document.querySelector("#extension-delivery-query"),
  extensionDeliveryListRefresh: document.querySelector("#extension-delivery-list-refresh"),
  extensionDeliveryList: document.querySelector("#extension-delivery-list"),
  extensionDeliveryListResult: document.querySelector("#extension-delivery-list-result"),
  automationGateForm: document.querySelector("#automation-gate-form"),
  automationGateEnabled: document.querySelector("#automation-gate-enabled"),
  automationConfigTtl: document.querySelector("#automation-config-ttl"),
  automationGateUsername: document.querySelector("#automation-gate-username"),
  automationGatePassword: document.querySelector("#automation-gate-password"),
  automationGateConfirm: document.querySelector("#automation-gate-confirm"),
  automationGateResult: document.querySelector("#automation-gate-result"),
  automationProviderForm: document.querySelector("#automation-provider-form"),
  automationProviderId: document.querySelector("#automation-provider-id"),
  automationProviderName: document.querySelector("#automation-provider-name"),
  automationProviderAdapter: document.querySelector("#automation-provider-adapter"),
  automationProviderBaseUrl: document.querySelector("#automation-provider-base-url"),
  automationProviderApiKey: document.querySelector("#automation-provider-api-key"),
  automationProviderStatus: document.querySelector("#automation-provider-status"),
  automationProviderCancel: document.querySelector("#automation-provider-cancel"),
  automationProviderRefresh: document.querySelector("#automation-provider-refresh"),
  automationProviderResult: document.querySelector("#automation-provider-result"),
  automationProviderList: document.querySelector("#automation-provider-list"),
  automationMappingForm: document.querySelector("#automation-mapping-form"),
  automationMappingId: document.querySelector("#automation-mapping-id"),
  automationMappingProduct: document.querySelector("#automation-mapping-product"),
  automationMappingProvider: document.querySelector("#automation-mapping-provider"),
  automationMappingPlan: document.querySelector("#automation-mapping-plan"),
  automationMappingRegion: document.querySelector("#automation-mapping-region"),
  automationMappingCardPlatform: document.querySelector("#automation-mapping-card-platform"),
  automationMappingCardProduct: document.querySelector("#automation-mapping-card-product"),
  automationMappingCapacityKey: document.querySelector("#automation-mapping-capacity-key"),
  automationMappingCardCapacity: document.querySelector("#automation-mapping-card-capacity"),
  automationMappingFunding: document.querySelector("#automation-mapping-funding"),
  automationMappingPriceMin: document.querySelector("#automation-mapping-price-min"),
  automationMappingPriceMax: document.querySelector("#automation-mapping-price-max"),
  automationMappingDailyRisk: document.querySelector("#automation-mapping-daily-risk"),
  automationMappingPriority: document.querySelector("#automation-mapping-priority"),
  automationMappingEnabled: document.querySelector("#automation-mapping-enabled"),
  automationMappingCancel: document.querySelector("#automation-mapping-cancel"),
  automationMappingRefresh: document.querySelector("#automation-mapping-refresh"),
  automationMappingResult: document.querySelector("#automation-mapping-result"),
  automationMappingList: document.querySelector("#automation-mapping-list"),
  automationExecutionRefresh: document.querySelector("#automation-execution-refresh"),
  automationExecutionList: document.querySelector("#automation-execution-list"),
  automationExecutionResult: document.querySelector("#automation-execution-result"),
  membershipFulfillmentSettingsForm: document.querySelector("#membership-fulfillment-settings-form"),
  membershipOpenApiBase: document.querySelector("#membership-openapi-base"),
  membershipAppId: document.querySelector("#membership-app-id"),
  membershipAppSecret: document.querySelector("#membership-app-secret"),
  membershipClearAppSecret: document.querySelector("#membership-clear-app-secret"),
  membershipWebhookSecret: document.querySelector("#membership-webhook-secret"),
  membershipClearWebhookSecret: document.querySelector("#membership-clear-webhook-secret"),
	membershipGptToken: document.querySelector("#membership-gpt-token"),
	membershipClearGptToken: document.querySelector("#membership-clear-gpt-token"),
  membershipStateProviderUrl: document.querySelector("#membership-state-provider-url"),
  membershipCheckoutBrokerUrl: document.querySelector("#membership-checkout-broker-url"),
  membershipFulfillmentStatus: document.querySelector("#membership-fulfillment-status"),
  membershipFulfillmentSettingsResult: document.querySelector("#membership-fulfillment-settings-result"),
  membershipEfunCardSettingsForm: document.querySelector("#membership-efuncard-settings-form"),
  membershipEfunCardBaseUrl: document.querySelector("#membership-efuncard-base-url"),
  membershipEfunCardApiKey: document.querySelector("#membership-efuncard-api-key"),
  membershipEfunCardClearApiKey: document.querySelector("#membership-efuncard-clear-api-key"),
  membershipEfunCardPriority: document.querySelector("#membership-efuncard-priority"),
  membershipEfunCardEnabled: document.querySelector("#membership-efuncard-enabled"),
  membershipEfunCardSettingsResult: document.querySelector("#membership-efuncard-settings-result"),
  membershipFulfillmentRefresh: document.querySelector("#membership-fulfillment-refresh"),
  membershipFulfillmentListRefresh: document.querySelector("#membership-fulfillment-list-refresh"),
  membershipFulfillmentBackfillForm: document.querySelector("#membership-fulfillment-backfill-form"),
  membershipFulfillmentBackfillOrder: document.querySelector("#membership-fulfillment-backfill-order"),
  membershipFulfillmentList: document.querySelector("#membership-fulfillment-list"),
  membershipFulfillmentListResult: document.querySelector("#membership-fulfillment-list-result"),
  membershipFulfillmentDetail: document.querySelector("#membership-fulfillment-detail"),
  membershipInventoryInitialize: document.querySelector("#membership-inventory-initialize"),
  membershipInventoryRefresh: document.querySelector("#membership-inventory-refresh"),
  membershipInventoryPlatform: document.querySelector("#membership-inventory-platform"),
  membershipInventoryProgress: document.querySelector("#membership-inventory-progress"),
  membershipCardListRefresh: document.querySelector("#membership-card-list-refresh"),
  membershipCardList: document.querySelector("#membership-card-list"),
  membershipCardListResult: document.querySelector("#membership-card-list-result"),
  membershipPriceContractForm: document.querySelector("#membership-price-contract-form"),
  membershipPriceContractTier: document.querySelector("#membership-price-contract-tier"),
  membershipPriceContractMin: document.querySelector("#membership-price-contract-min"),
  membershipPriceContractMax: document.querySelector("#membership-price-contract-max"),
  membershipPriceContractList: document.querySelector("#membership-price-contract-list"),
  membershipPriceContractResult: document.querySelector("#membership-price-contract-result"),
  membershipProductPolicyRefresh: document.querySelector("#membership-product-policy-refresh"),
  membershipProductPolicyList: document.querySelector("#membership-product-policy-list"),
  membershipProductPolicyResult: document.querySelector("#membership-product-policy-result"),
  membershipNoChargeForm: document.querySelector("#membership-no-charge-form"),
  membershipNoChargeSite: document.querySelector("#membership-no-charge-site"),
  membershipNoChargeProduct: document.querySelector("#membership-no-charge-product"),
  membershipNoChargeTier: document.querySelector("#membership-no-charge-tier"),
  membershipNoChargeAdapter: document.querySelector("#membership-no-charge-adapter"),
  membershipNoChargeContract: document.querySelector("#membership-no-charge-contract"),
  membershipNoChargeAmount: document.querySelector("#membership-no-charge-amount"),
  membershipNoChargeOrigin: document.querySelector("#membership-no-charge-origin"),
  membershipNoChargeRoute: document.querySelector("#membership-no-charge-route"),
  membershipNoChargePlan: document.querySelector("#membership-no-charge-plan"),
  membershipNoChargeFields: document.querySelector("#membership-no-charge-fields"),
  membershipNoChargeControl: document.querySelector("#membership-no-charge-control"),
  membershipNoChargeList: document.querySelector("#membership-no-charge-list"),
  membershipNoChargeResult: document.querySelector("#membership-no-charge-result"),
  membershipCircuitRefresh: document.querySelector("#membership-circuit-refresh"),
  membershipCircuitList: document.querySelector("#membership-circuit-list"),
  membershipCircuitResult: document.querySelector("#membership-circuit-result"),
  membershipRolloutModeForm: document.querySelector("#membership-rollout-mode-form"),
  membershipRolloutMode: document.querySelector("#membership-rollout-mode"),
  membershipRolloutAdminUsername: document.querySelector("#membership-rollout-admin-username"),
  membershipRolloutAdminPassword: document.querySelector("#membership-rollout-admin-password"),
  membershipRolloutConfirm: document.querySelector("#membership-rollout-confirm"),
  membershipRolloutResult: document.querySelector("#membership-rollout-result"),
  membershipCanaryStartForm: document.querySelector("#membership-canary-start-form"),
  membershipCanaryStartFulfillment: document.querySelector("#membership-canary-start-fulfillment"),
  membershipCanaryStartAdminUsername: document.querySelector("#membership-canary-start-admin-username"),
  membershipCanaryStartAdminPassword: document.querySelector("#membership-canary-start-admin-password"),
  membershipCanaryStartConfirm: document.querySelector("#membership-canary-start-confirm"),
  membershipCanaryStartResult: document.querySelector("#membership-canary-start-result"),
  membershipCanaryRefresh: document.querySelector("#membership-canary-refresh"),
  membershipCanaryReadyList: document.querySelector("#membership-canary-ready-list"),
  membershipCanaryAuthorizationList: document.querySelector("#membership-canary-authorization-list"),
  membershipCanaryForm: document.querySelector("#membership-canary-form"),
  membershipCanaryFulfillment: document.querySelector("#membership-canary-fulfillment"),
  membershipCanaryStage: document.querySelector("#membership-canary-stage"),
  membershipCanaryCard: document.querySelector("#membership-canary-card"),
  membershipCanaryBudget: document.querySelector("#membership-canary-budget"),
  membershipCanaryContract: document.querySelector("#membership-canary-contract"),
  membershipCanaryAdapter: document.querySelector("#membership-canary-adapter"),
  membershipCanaryFingerprint: document.querySelector("#membership-canary-fingerprint"),
  membershipCanaryAdminUsername: document.querySelector("#membership-canary-admin-username"),
  membershipCanaryAdminPassword: document.querySelector("#membership-canary-admin-password"),
  membershipCanaryConfirm: document.querySelector("#membership-canary-confirm"),
  membershipCanarySubmit: document.querySelector("#membership-canary-submit"),
  membershipCanaryResult: document.querySelector("#membership-canary-result"),
  membershipQualificationRefresh: document.querySelector("#membership-qualification-refresh"),
  membershipQualificationForm: document.querySelector("#membership-qualification-form"),
  membershipQualificationFulfillment: document.querySelector("#membership-qualification-fulfillment"),
  membershipQualificationAdapter: document.querySelector("#membership-qualification-adapter"),
  membershipQualificationPath: document.querySelector("#membership-qualification-path"),
  membershipQualificationContract: document.querySelector("#membership-qualification-contract"),
  membershipQualificationList: document.querySelector("#membership-qualification-list"),
  membershipQualificationResult: document.querySelector("#membership-qualification-result"),
  membershipCompensationForm: document.querySelector("#membership-compensation-form"),
  membershipCompensationFulfillment: document.querySelector("#membership-compensation-fulfillment"),
  membershipCompensationType: document.querySelector("#membership-compensation-type"),
  membershipCompensationEvidence: document.querySelector("#membership-compensation-evidence"),
  membershipCompensationConfirm: document.querySelector("#membership-compensation-confirm"),
  membershipCompensationResult: document.querySelector("#membership-compensation-result"),
  membershipAutomaticScopeRefresh: document.querySelector("#membership-automatic-scope-refresh"),
  membershipAutomaticScopeForm: document.querySelector("#membership-automatic-scope-form"),
  membershipAutomaticSite: document.querySelector("#membership-automatic-site"),
  membershipAutomaticProduct: document.querySelector("#membership-automatic-product"),
  membershipAutomaticTier: document.querySelector("#membership-automatic-tier"),
  membershipAutomaticAdapter: document.querySelector("#membership-automatic-adapter"),
  membershipAutomaticContract: document.querySelector("#membership-automatic-contract"),
  membershipAutomaticOrderLimit: document.querySelector("#membership-automatic-order-limit"),
  membershipAutomaticRiskLimit: document.querySelector("#membership-automatic-risk-limit"),
  membershipAutomaticAdminUsername: document.querySelector("#membership-automatic-admin-username"),
  membershipAutomaticAdminPassword: document.querySelector("#membership-automatic-admin-password"),
  membershipAutomaticConfirm: document.querySelector("#membership-automatic-confirm"),
  membershipAutomaticRevisionForm: document.querySelector("#membership-automatic-revision-form"),
  membershipAutomaticRevisionId: document.querySelector("#membership-automatic-revision-id"),
  membershipAutomaticRevisionOrderLimit: document.querySelector("#membership-automatic-revision-order-limit"),
  membershipAutomaticRevisionRiskLimit: document.querySelector("#membership-automatic-revision-risk-limit"),
  membershipAutomaticRevisionAdapter: document.querySelector("#membership-automatic-revision-adapter"),
  membershipAutomaticRevisionContract: document.querySelector("#membership-automatic-revision-contract"),
  membershipAutomaticRevisionAdminUsername: document.querySelector("#membership-automatic-revision-admin-username"),
  membershipAutomaticRevisionAdminPassword: document.querySelector("#membership-automatic-revision-admin-password"),
  membershipAutomaticRevisionConfirm: document.querySelector("#membership-automatic-revision-confirm"),
  membershipAutomaticScopeList: document.querySelector("#membership-automatic-scope-list"),
  membershipAutomaticScopeResult: document.querySelector("#membership-automatic-scope-result"),
  membershipInterventionRefresh: document.querySelector("#membership-intervention-refresh"),
  membershipInterventionList: document.querySelector("#membership-intervention-list"),
  membershipInterventionResult: document.querySelector("#membership-intervention-result"),
  orderList: document.querySelector("#order-list"),
  jobList: document.querySelector("#job-list"),
  retryJobsBtn: document.querySelector("#retry-jobs-btn"),
  logList: document.querySelector("#log-list"),
  systemVersionCards: document.querySelector("#system-version-cards"),
  checkEnvironmentBtn: document.querySelector("#check-environment-btn"),
  checkUpdateBtn: document.querySelector("#check-update-btn"),
  startUpdateBtn: document.querySelector("#start-update-btn"),
  systemUpdateHint: document.querySelector("#system-update-hint"),
  systemUpdateLog: document.querySelector("#system-update-log"),
  migrationBackupBtn: document.querySelector("#migration-backup-btn"),
  migrationBackupResult: document.querySelector("#migration-backup-result"),
  migrationRestoreFile: document.querySelector("#migration-restore-file"),
  migrationValidateBtn: document.querySelector("#migration-validate-btn"),
  migrationRestoreSummary: document.querySelector("#migration-restore-summary"),
  migrationConfirmInput: document.querySelector("#migration-confirm-input"),
  migrationRestoreBtn: document.querySelector("#migration-restore-btn"),
  migrationRestoreResult: document.querySelector("#migration-restore-result"),
  batchSite: document.querySelector("#batch-site"),
  batchImportType: document.querySelector("#batch-import-type"),
  singleSite: document.querySelector("#single-site"),
  singleEmailToken: document.querySelector("#single-email-token"),
  singleProcessingMode: document.querySelector("#single-processing-mode"),
  singleManualType: document.querySelector("#single-manual-type"),
  subCardTypeForm: document.querySelector("#sub-card-type-form"),
  subCtName: document.querySelector("#sub-ct-name"),
  subCtTotal: document.querySelector("#sub-ct-total"),
  subCtEditId: document.querySelector("#sub-ct-edit-id"),
  subCtSubmitBtn: document.querySelector("#sub-ct-submit-btn"),
  subCtCancelBtn: document.querySelector("#sub-ct-cancel-btn"),
  subCtResult: document.querySelector("#sub-ct-result"),
  subCardTypeList: document.querySelector("#sub-card-type-list"),
  subRequestList: document.querySelector("#sub-request-list"),
  notifySettingsForm: document.querySelector("#notify-settings-form"),
  notifyGlobalWebhook: document.querySelector("#notify-global-webhook"),
  notifySettingsResult: document.querySelector("#notify-settings-result"),
  notifyTestGlobalWebhook: document.querySelector("#notify-test-global-webhook"),
  notifyMonitorForm: document.querySelector("#notify-monitor-form"),
  notifyFormTitle: document.querySelector("#notify-form-title"),
  notifyFormCancel: document.querySelector("#notify-form-cancel"),
  notifyEditId: document.querySelector("#notify-edit-id"),
  notifyName: document.querySelector("#notify-name"),
  notifyMonitorType: document.querySelector("#notify-monitor-type"),
  notifyEnabled: document.querySelector("#notify-enabled"),
  notifyMethod: document.querySelector("#notify-method"),
  notifyInterval: document.querySelector("#notify-interval"),
  notifyUrl: document.querySelector("#notify-url"),
  notifyBrowserFields: document.querySelector("#notify-browser-fields"),
  notifyBrowserPageUrl: document.querySelector("#notify-browser-page-url"),
  notifyBrowserReadySelector: document.querySelector("#notify-browser-ready-selector"),
  notifyBrowserWaitMs: document.querySelector("#notify-browser-wait-ms"),
  notifyHeaders: document.querySelector("#notify-headers"),
  notifyBody: document.querySelector("#notify-body"),
  notifyWatchFields: document.querySelector("#notify-watch-fields"),
  notifyMatchMode: document.querySelector("#notify-match-mode"),
  notifyRulesList: document.querySelector("#notify-rules-list"),
  notifyAddRule: document.querySelector("#notify-add-rule"),
  notifyWebhookOverride: document.querySelector("#notify-webhook-override"),
  notifyTitle: document.querySelector("#notify-title"),
  notifyTimeout: document.querySelector("#notify-timeout"),
  notifyCooldown: document.querySelector("#notify-cooldown"),
  notifySubmitBtn: document.querySelector("#notify-submit-btn"),
  notifyTestRunBtn: document.querySelector("#notify-test-run-btn"),
  notifyFormResult: document.querySelector("#notify-form-result"),
  notifyRefreshBtn: document.querySelector("#notify-refresh-btn"),
  notifyMonitorList: document.querySelector("#notify-monitor-list"),
  notifyEventList: document.querySelector("#notify-event-list"),
  // SMS panel refs
  smsSiteForm: document.querySelector("#sms-site-form"),
  smsSiteName: document.querySelector("#sms-site-name"),
  smsSiteSlug: document.querySelector("#sms-site-slug"),
  smsSiteInventorySource: document.querySelector("#sms-site-inventory-source"),
  smsSiteApiKey: document.querySelector("#sms-site-api-key"),
  smsSiteAppId: document.querySelector("#sms-site-app-id"),
  smsSiteCardType: document.querySelector("#sms-site-card-type"),
  smsSiteExpiry: document.querySelector("#sms-site-expiry"),
  smsSiteNote: document.querySelector("#sms-site-note"),
  smsSiteResult: document.querySelector("#sms-site-result"),
  smsSiteList: document.querySelector("#sms-site-list"),
  smsCardForm: document.querySelector("#sms-card-form"),
  smsCardSite: document.querySelector("#sms-card-site"),
  smsCardPrefix: document.querySelector("#sms-card-prefix"),
  smsCardCount: document.querySelector("#sms-card-count"),
  smsCardNote: document.querySelector("#sms-card-note"),
  smsCardResult: document.querySelector("#sms-card-result"),
  smsCardList: document.querySelector("#sms-card-list"),
  smsCardAction: document.querySelector("#sms-card-action"),
  smsCardActionBtn: document.querySelector("#sms-card-action-btn"),
  smsOrderList: document.querySelector("#sms-order-list"),
  smsBatchForm: document.querySelector("#sms-batch-form"),
  smsBatchResult: document.querySelector("#sms-batch-result"),
  smsSingleForm: document.querySelector("#sms-single-form"),
  smsSingleResult: document.querySelector("#sms-single-result"),
  smsList: document.querySelector("#sms-list"),
  smsCopyKeysBtn: document.querySelector("#sms-copy-keys-btn"),
  smsCopyInfoBtn: document.querySelector("#sms-copy-info-btn"),
  smsExportExcelBtn: document.querySelector("#sms-export-excel-btn"),
  smsAction: document.querySelector("#sms-action"),
  smsActionBtn: document.querySelector("#sms-action-btn"),
  // Quota system refs
  quotaStats: document.querySelector("#quota-stats"),
  quotaApiKeyForm: document.querySelector("#quota-api-key-form"),
  quotaApiKeyInput: document.querySelector("#quota-api-key-input"),
  quotaApiKeyResult: document.querySelector("#quota-api-key-result"),
  quotaImportForm: document.querySelector("#quota-import-form"),
  quotaImportCodes: document.querySelector("#quota-import-codes"),
  quotaImportResult: document.querySelector("#quota-import-result"),
  quotaImportDetailCard: document.querySelector("#quota-import-detail-card"),
  quotaImportDetail: document.querySelector("#quota-import-detail"),
  quotaSourceCardList: document.querySelector("#quota-source-card-list"),
  quotaSourceCardsRefreshBtn: document.querySelector("#quota-source-cards-refresh-btn"),
  quotaSourceCardsExportBtn: document.querySelector("#quota-source-cards-export-btn"),
  quotaSourceCardsExportAllBtn: document.querySelector("#quota-source-cards-export-all-btn"),
  quotaSourceCardsMergeBtn: document.querySelector("#quota-source-cards-merge-btn"),
  quotaSourceCardsMergeResult: document.querySelector("#quota-source-cards-merge-result"),
  quotaSettingsForm: document.querySelector("#quota-settings-form"),
  quotaLowStockThreshold: document.querySelector("#quota-low-stock-threshold"),
  quotaSettingsResult: document.querySelector("#quota-settings-result"),
  quotaSubCardForm: document.querySelector("#quota-sub-card-form"),
  quotaSubCardQuota: document.querySelector("#quota-sub-card-quota"),
  quotaSubCardCount: document.querySelector("#quota-sub-card-count"),
  quotaSubCardResult: document.querySelector("#quota-sub-card-result"),
  quotaSubCardList: document.querySelector("#quota-sub-card-list"),
  quotaSubCardStatus: document.querySelector("#quota-sub-card-status"),
  quotaSubCardPageSize: document.querySelector("#quota-sub-card-page-size"),
  quotaSubCardPagination: document.querySelector("#quota-sub-card-pagination"),
  quotaSubCardRefreshBtn: document.querySelector("#quota-sub-card-refresh-btn"),
  quotaSubCardCopyBtn: document.querySelector("#quota-sub-card-copy-btn"),
  quotaSubCardExportBtn: document.querySelector("#quota-sub-card-export-btn"),
  quotaSubCardDetailCard: document.querySelector("#quota-sub-card-detail-card"),
  quotaSubCardDetail: document.querySelector("#quota-sub-card-detail"),
  quotaSubCardHistory: document.querySelector("#quota-sub-card-history"),
  quotaSubCardDetailClose: document.querySelector("#quota-sub-card-detail-close"),
  sub2apiConnectionForm: document.querySelector("#sub2api-connection-form"),
  sub2apiConnectionFormTitle: document.querySelector("#sub2api-connection-form-title"),
  sub2apiConnectionEditId: document.querySelector("#sub2api-connection-edit-id"),
  sub2apiConnectionName: document.querySelector("#sub2api-connection-name"),
  sub2apiConnectionBaseUrl: document.querySelector("#sub2api-connection-base-url"),
  sub2apiConnectionAdminToken: document.querySelector("#sub2api-connection-admin-token"),
  sub2apiConnectionStatus: document.querySelector("#sub2api-connection-status"),
  sub2apiConnectionSubmitBtn: document.querySelector("#sub2api-connection-submit-btn"),
  sub2apiConnectionCancelBtn: document.querySelector("#sub2api-connection-cancel-btn"),
  sub2apiConnectionRefreshBtn: document.querySelector("#sub2api-connection-refresh-btn"),
  sub2apiConnectionResult: document.querySelector("#sub2api-connection-result"),
  sub2apiConnectionList: document.querySelector("#sub2api-connection-list"),
  shakeCampaignForm: document.querySelector("#shake-campaign-form"),
  shakeCampaignFormTitle: document.querySelector("#shake-campaign-form-title"),
  shakeCampaignEditId: document.querySelector("#shake-campaign-edit-id"),
  shakeCampaignConnection: document.querySelector("#shake-campaign-connection"),
  shakeCampaignName: document.querySelector("#shake-campaign-name"),
  shakeCampaignStart: document.querySelector("#shake-campaign-start"),
  shakeCampaignEnd: document.querySelector("#shake-campaign-end"),
  shakeSubscriptionRuleEditor: document.querySelector("#shake-subscription-rule-editor"),
  shakeAddSubscriptionRuleBtn: document.querySelector("#shake-add-subscription-rule-btn"),
  shakeUsageRuleEditor: document.querySelector("#shake-usage-rule-editor"),
  shakeAddUsageRuleBtn: document.querySelector("#shake-add-usage-rule-btn"),
  shakeBalanceThreshold: document.querySelector("#shake-balance-threshold"),
  shakeBalanceTier: document.querySelector("#shake-balance-tier"),
  shakePrizeEditor: document.querySelector("#shake-prize-editor"),
  shakeAddPrizeBtn: document.querySelector("#shake-add-prize-btn"),
  shakeCampaignSubmitBtn: document.querySelector("#shake-campaign-submit-btn"),
  shakeCampaignResetBtn: document.querySelector("#shake-campaign-reset-btn"),
  shakeCampaignResult: document.querySelector("#shake-campaign-result"),
  shakeCampaignFilter: document.querySelector("#shake-campaign-filter"),
  shakeCampaignRefreshBtn: document.querySelector("#shake-campaign-refresh-btn"),
  shakeCampaignList: document.querySelector("#shake-campaign-list"),
  shakeEmbedUrl: document.querySelector("#shake-embed-url"),
  shakeCopyEmbedBtn: document.querySelector("#shake-copy-embed-btn"),
  shakePreviewLink: document.querySelector("#shake-preview-link"),
  shakeEmbedResult: document.querySelector("#shake-embed-result"),
  shakeSyncConnection: document.querySelector("#shake-sync-connection"),
  shakeSyncUsageBtn: document.querySelector("#shake-sync-usage-btn"),
  shakeSyncResult: document.querySelector("#shake-sync-result"),
  shakeManualGrantForm: document.querySelector("#shake-manual-grant-form"),
  shakeGrantCampaign: document.querySelector("#shake-grant-campaign"),
  shakeGrantUser: document.querySelector("#shake-grant-user"),
  shakeGrantQuantity: document.querySelector("#shake-grant-quantity"),
  shakeGrantTier: document.querySelector("#shake-grant-tier"),
  shakeGrantEmail: document.querySelector("#shake-grant-email"),
  shakeGrantReason: document.querySelector("#shake-grant-reason"),
  shakeGrantResult: document.querySelector("#shake-grant-result"),
  shakeDrawStatusFilter: document.querySelector("#shake-draw-status-filter"),
  shakeDrawUserFilter: document.querySelector("#shake-draw-user-filter"),
  shakeDrawRefreshBtn: document.querySelector("#shake-draw-refresh-btn"),
  shakeDrawList: document.querySelector("#shake-draw-list"),
  shakeDrawResult: document.querySelector("#shake-draw-result"),
  sub2apiUpstreamMonitorConnection: document.querySelector("#sub2api-upstream-monitor-connection"),
  sub2apiUpstreamMonitorRefreshBtn: document.querySelector("#sub2api-upstream-monitor-refresh-btn"),
  sub2apiUpstreamMonitorList: document.querySelector("#sub2api-upstream-monitor-list"),
  sub2apiUpstreamMonitorResult: document.querySelector("#sub2api-upstream-monitor-result"),
  sub2apiModelRouteConnection: document.querySelector("#sub2api-model-route-connection"),
  sub2apiModelRouteFilter: document.querySelector("#sub2api-model-route-filter"),
  sub2apiModelRouteRefreshBtn: document.querySelector("#sub2api-model-route-refresh-btn"),
  sub2apiModelRouteSummary: document.querySelector("#sub2api-model-route-summary"),
  sub2apiModelRouteList: document.querySelector("#sub2api-model-route-list"),
  sub2apiModelRouteResult: document.querySelector("#sub2api-model-route-result"),
  sub2apiInviteConnectionFilter: document.querySelector("#sub2api-invite-connection-filter"),
  sub2apiInviteUserFilter: document.querySelector("#sub2api-invite-user-filter"),
  sub2apiInviteStatusFilter: document.querySelector("#sub2api-invite-status-filter"),
  sub2apiInviteRefreshBtn: document.querySelector("#sub2api-invite-refresh-btn"),
  sub2apiInviteSyncBtn: document.querySelector("#sub2api-invite-sync-btn"),
  sub2apiInviteCopyBtn: document.querySelector("#sub2api-invite-copy-btn"),
  sub2apiInviteExportBtn: document.querySelector("#sub2api-invite-export-btn"),
  sub2apiInviteList: document.querySelector("#sub2api-invite-list"),
  sub2apiInviteResult: document.querySelector("#sub2api-invite-result"),
  sub2apiLevelLoadBtn: document.querySelector("#sub2api-level-load-btn"),
  sub2apiLevelTemplate: document.querySelector("#sub2api-level-template"),
  sub2apiLevelRecommendedBtn: document.querySelector("#sub2api-level-recommended-btn"),
  sub2apiLevelAddBtn: document.querySelector("#sub2api-level-add-btn"),
  sub2apiLevelSaveBtn: document.querySelector("#sub2api-level-save-btn"),
  sub2apiLevelList: document.querySelector("#sub2api-level-list"),
  sub2apiLevelResult: document.querySelector("#sub2api-level-result"),
  sub2apiRebateStatusFilter: document.querySelector("#sub2api-rebate-status-filter"),
  sub2apiRebateSyncBtn: document.querySelector("#sub2api-rebate-sync-btn"),
  sub2apiRebateRefreshBtn: document.querySelector("#sub2api-rebate-refresh-btn"),
  sub2apiRebateList: document.querySelector("#sub2api-rebate-list"),
  sub2apiRebateResult: document.querySelector("#sub2api-rebate-result"),
  sub2apiPlanForm: document.querySelector("#sub2api-plan-form"),
  sub2apiPlanFormTitle: document.querySelector("#sub2api-plan-form-title"),
  sub2apiPlanEditId: document.querySelector("#sub2api-plan-edit-id"),
  sub2apiPlanConnection: document.querySelector("#sub2api-plan-connection"),
  sub2apiPlanName: document.querySelector("#sub2api-plan-name"),
  sub2apiPlanPrice: document.querySelector("#sub2api-plan-price"),
  sub2apiPlanValidityDays: document.querySelector("#sub2api-plan-validity-days"),
  sub2apiPlanSubscriptionGroupId: document.querySelector("#sub2api-plan-subscription-group-id"),
  sub2apiPlanSourceDedicatedGroupId: document.querySelector("#sub2api-plan-source-dedicated-group-id"),
  sub2apiPlanDedicatedGroupId: document.querySelector("#sub2api-plan-dedicated-group-id"),
  sub2apiPlanSortOrder: document.querySelector("#sub2api-plan-sort-order"),
  sub2apiPlanStatus: document.querySelector("#sub2api-plan-status"),
  sub2apiPlanDescription: document.querySelector("#sub2api-plan-description"),
  sub2apiPlanSubmitBtn: document.querySelector("#sub2api-plan-submit-btn"),
  sub2apiPlanCancelBtn: document.querySelector("#sub2api-plan-cancel-btn"),
  sub2apiPlanRefreshBtn: document.querySelector("#sub2api-plan-refresh-btn"),
  sub2apiPlanResult: document.querySelector("#sub2api-plan-result"),
  sub2apiPlanList: document.querySelector("#sub2api-plan-list"),
  sub2apiOrderConnectionFilter: document.querySelector("#sub2api-order-connection-filter"),
  sub2apiOrderUserFilter: document.querySelector("#sub2api-order-user-filter"),
  sub2apiOrderStatusFilter: document.querySelector("#sub2api-order-status-filter"),
  sub2apiOrderRefreshBtn: document.querySelector("#sub2api-order-refresh-btn"),
  sub2apiOrderList: document.querySelector("#sub2api-order-list"),
  sub2apiOrderResult: document.querySelector("#sub2api-order-result"),
  worldCupApiSettingsForm: document.querySelector("#worldcup-api-settings-form"),
  worldCupApiProvider: document.querySelector("#worldcup-api-provider"),
  worldCupApiEnabled: document.querySelector("#worldcup-api-enabled"),
  worldCupApiKey: document.querySelector("#worldcup-api-key"),
  worldCupApiBaseUrl: document.querySelector("#worldcup-api-base-url"),
  worldCupApiTimezone: document.querySelector("#worldcup-api-timezone"),
  worldCupApiSeason: document.querySelector("#worldcup-api-season"),
  worldCupApiSoftLimit: document.querySelector("#worldcup-api-soft-limit"),
  worldCupApiHardLimit: document.querySelector("#worldcup-api-hard-limit"),
  worldCupApiSyncIntervalMs: document.querySelector("#worldcup-api-sync-interval-ms"),
  worldCupApiClearKey: document.querySelector("#worldcup-api-clear-key"),
  worldCupApiSettingsSubmitBtn: document.querySelector("#worldcup-api-settings-submit-btn"),
  worldCupApiSettingsRefreshBtn: document.querySelector("#worldcup-api-settings-refresh-btn"),
  worldCupApiManualSyncBtn: document.querySelector("#worldcup-api-manual-sync-btn"),
  worldCupApiUsage: document.querySelector("#worldcup-api-usage"),
  worldCupApiSettingsResult: document.querySelector("#worldcup-api-settings-result"),
  worldCupMatchForm: document.querySelector("#worldcup-match-form"),
  worldCupMatchFormTitle: document.querySelector("#worldcup-match-form-title"),
  worldCupMatchEditId: document.querySelector("#worldcup-match-edit-id"),
  worldCupMatchConnection: document.querySelector("#worldcup-match-connection"),
  worldCupMatchStage: document.querySelector("#worldcup-match-stage"),
  worldCupMatchGroup: document.querySelector("#worldcup-match-group"),
  worldCupMatchHome: document.querySelector("#worldcup-match-home"),
  worldCupMatchAway: document.querySelector("#worldcup-match-away"),
  worldCupMatchKickoff: document.querySelector("#worldcup-match-kickoff"),
  worldCupMatchStatus: document.querySelector("#worldcup-match-status"),
  worldCupOddsHome: document.querySelector("#worldcup-odds-home"),
  worldCupOddsDraw: document.querySelector("#worldcup-odds-draw"),
  worldCupOddsAway: document.querySelector("#worldcup-odds-away"),
  worldCupMinStake: document.querySelector("#worldcup-min-stake"),
  worldCupMaxStake: document.querySelector("#worldcup-max-stake"),
  worldCupMatchNote: document.querySelector("#worldcup-match-note"),
  worldCupMatchSubmitBtn: document.querySelector("#worldcup-match-submit-btn"),
  worldCupMatchCancelBtn: document.querySelector("#worldcup-match-cancel-btn"),
  worldCupMatchResult: document.querySelector("#worldcup-match-result"),
  worldCupMatchConnectionFilter: document.querySelector("#worldcup-match-connection-filter"),
  worldCupMatchStatusFilter: document.querySelector("#worldcup-match-status-filter"),
  worldCupMatchRefreshBtn: document.querySelector("#worldcup-match-refresh-btn"),
  worldCupMatchList: document.querySelector("#worldcup-match-list"),
  worldCupBetConnectionFilter: document.querySelector("#worldcup-bet-connection-filter"),
  worldCupBetMatchFilter: document.querySelector("#worldcup-bet-match-filter"),
  worldCupBetUserFilter: document.querySelector("#worldcup-bet-user-filter"),
  worldCupBetStatusFilter: document.querySelector("#worldcup-bet-status-filter"),
  worldCupBetRefreshBtn: document.querySelector("#worldcup-bet-refresh-btn"),
  worldCupBetExportBtn: document.querySelector("#worldcup-bet-export-btn"),
  worldCupBetList: document.querySelector("#worldcup-bet-list"),
  worldCupBetResult: document.querySelector("#worldcup-bet-result"),

  navItems: document.querySelectorAll(".nav-item"),
  tabPanels: document.querySelectorAll(".tab-panel")
};

let autoRefreshTimer = null;
let updatePollTimer = null;
let currentTab = "dashboard";
const tablePaginationState = new Map();
const DEFAULT_TABLE_PAGE_SIZE = 20;
const TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50];
const quotaSubCardState = {
  page: 1,
  pageSize: Number(refs.quotaSubCardPageSize?.value || DEFAULT_TABLE_PAGE_SIZE),
  status: refs.quotaSubCardStatus?.value || "",
  total: 0
};
let sub2apiConnectionsCache = [];
let shakeCampaignsCache = [];
let sub2apiInvitesCache = [];
let sub2apiRebatesCache = [];
let sub2apiLevelsCache = [];
let sub2apiPlansCache = [];
let sub2apiOrdersCache = [];
let sub2apiModelRoutesCache = null;
let worldCupMatchesCache = [];
let worldCupBetsCache = [];
let storeMappingsCache = [];
let storeTasksCache = [];
let automationProvidersCache = [];
let automationMappingsCache = [];
let automationStoreMappingsCache = [];
let membershipPreparedCanaries = new Map();
let membershipAutomaticScopes = new Map();
let migrationRestoreUploadId = null;
const SUB2API_LEVEL_TEMPLATES = {
  niu: [
    { id: "sub2api_inviter_level_default", name: "小牛牛", spendThreshold: 0, lifetimeInviteLimit: 3, unusedInviteLimit: 2, rebateRate: 3, sortOrder: 0, status: "active" },
    { id: "sub2api_inviter_level_bronze", name: "青铜牛牛", spendThreshold: 50, lifetimeInviteLimit: 6, unusedInviteLimit: 3, rebateRate: 5, sortOrder: 10, status: "active" },
    { id: "sub2api_inviter_level_silver", name: "白银牛牛", spendThreshold: 200, lifetimeInviteLimit: 12, unusedInviteLimit: 5, rebateRate: 8, sortOrder: 20, status: "active" },
    { id: "sub2api_inviter_level_gold", name: "黄金牛牛", spendThreshold: 500, lifetimeInviteLimit: 25, unusedInviteLimit: 8, rebateRate: 10, sortOrder: 30, status: "active" },
    { id: "sub2api_inviter_level_partner", name: "合伙牛牛", spendThreshold: 1000, lifetimeInviteLimit: 0, unusedInviteLimit: 12, rebateRate: 12, sortOrder: 40, status: "active" }
  ],
  steady: [
    { id: "sub2api_inviter_level_default", name: "小牛牛", spendThreshold: 0, lifetimeInviteLimit: 3, unusedInviteLimit: 2, rebateRate: 2, sortOrder: 0, status: "active" },
    { id: "sub2api_inviter_level_bronze", name: "青铜牛牛", spendThreshold: 50, lifetimeInviteLimit: 5, unusedInviteLimit: 2, rebateRate: 3, sortOrder: 10, status: "active" },
    { id: "sub2api_inviter_level_silver", name: "白银牛牛", spendThreshold: 200, lifetimeInviteLimit: 10, unusedInviteLimit: 4, rebateRate: 5, sortOrder: 20, status: "active" },
    { id: "sub2api_inviter_level_gold", name: "黄金牛牛", spendThreshold: 500, lifetimeInviteLimit: 20, unusedInviteLimit: 6, rebateRate: 8, sortOrder: 30, status: "active" },
    { id: "sub2api_inviter_level_partner", name: "合伙牛牛", spendThreshold: 1000, lifetimeInviteLimit: 0, unusedInviteLimit: 10, rebateRate: 10, sortOrder: 40, status: "active" }
  ],
  growth: [
    { id: "sub2api_inviter_level_default", name: "小牛牛", spendThreshold: 0, lifetimeInviteLimit: 5, unusedInviteLimit: 3, rebateRate: 5, sortOrder: 0, status: "active" },
    { id: "sub2api_inviter_level_bronze", name: "青铜牛牛", spendThreshold: 50, lifetimeInviteLimit: 10, unusedInviteLimit: 5, rebateRate: 8, sortOrder: 10, status: "active" },
    { id: "sub2api_inviter_level_silver", name: "白银牛牛", spendThreshold: 200, lifetimeInviteLimit: 20, unusedInviteLimit: 8, rebateRate: 10, sortOrder: 20, status: "active" },
    { id: "sub2api_inviter_level_gold", name: "黄金牛牛", spendThreshold: 500, lifetimeInviteLimit: 40, unusedInviteLimit: 12, rebateRate: 12, sortOrder: 30, status: "active" },
    { id: "sub2api_inviter_level_partner", name: "合伙牛牛", spendThreshold: 1000, lifetimeInviteLimit: 0, unusedInviteLimit: 20, rebateRate: 15, sortOrder: 40, status: "active" }
  ]
};

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function setHint(element, message) {
  if (element) element.textContent = message;
}

function setStatusMessage(element, message, type = "info") {
  if (!element) return;
  element.textContent = message || "";
  element.classList.remove("status-message", "status-message-info", "status-message-success", "status-message-error");
  if (!message) return;
  element.classList.add("status-message", `status-message-${type}`);
}

function setButtonBusy(button, busy, busyText) {
  if (!button) return;
  if (!button.dataset.idleText) {
    button.dataset.idleText = button.textContent;
  }
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
  button.textContent = busy ? busyText : button.dataset.idleText;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeCssIdentifier(value) {
  if (globalThis.CSS?.escape) return CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function maskToken(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
}

function maskMembershipIdentifier(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "-";
  if (normalized.length <= 16) return normalized;
  return `${normalized.slice(0, 10)}…${normalized.slice(-4)}`;
}

function membershipAdminError(error) {
  const message = error?.message || "请求失败";
  return error?.code && !message.includes(error.code) ? `${message}（${error.code}）` : message;
}

const STATUS_LABELS = {
  active: "启用",
  draft: "草稿",
  scheduled: "待开始",
  ended: "已结束",
  disabled: "禁用",
  deleted: "已删除",
  pending: "待处理",
  ok: "正常",
  processing: "处理中",
  succeeded: "已成功",
  failed: "失败",
  selected: "待发放",
  delivered: "已发放",
  delivery_failed: "发放失败",
  voided: "已作废",
  expired: "已过期",
  retrying: "重试中",
  refund_pending: "退款锁定中",
  issuance_uncertain: "发码结果待核对",
  inventory: "可复用库存",
  allocated: "已分配",
  claimed: "已绑定账号",
  submitting: "正在提交兑换",
  queued: "排队中",
  running: "开通中",
  review: "等待支付对账",
  failed_resolution: "等待人工处理",
  refund_hold: "退款核验中",
  held: "暂停使用",
  held_contract: "接口契约不完整",
  funding_blocked: "资金不足",
  contract_blocked: "接口契约不完整",
  manually_closed: "已人工收尾",
  consumed: "已消耗",
  blocked: "需人工处理",
  conflict: "交付冲突",
  canceled: "已取消",
  approved: "已通过",
  rejected: "已驳回",
  revoked: "已撤销",
  used: "已使用",
  unused: "未使用",
  locked: "已锁定",
  void: "已作废",
  abnormal: "异常",
  open: "开放中",
  finished: "已结束",
  closed: "已关闭",
  settled: "已结算",
  cancelled: "已取消",
  payout_pending: "待派奖",
  payout_failed: "派奖失败",
  payout_succeeded: "派奖成功",
  checking: "检查中",
  cancelling: "关闭中",
  retry_wait: "等待重试",
  account_wait: "等待会员到期",
  human_review: "待人工确认",
  passed: "续费已保护"
};

const EXTENSION_DELIVERY_ERROR_LABELS = {
  EXTENSION_UNAUTHORIZED: "扩展 Token 无效",
  EXTENSION_INSTALLATION_MISMATCH: "扩展安装实例与绑定不一致",
  EXTENSION_DELIVERY_DISABLED: "扩展自动交付未启用",
  EXTENSION_RATE_LIMITED: "扩展请求过于频繁",
  EXTENSION_DELIVERY_BUSY: "Cookie 转换请求正在处理中",
  DELIVERY_NOT_FOUND: "交付订单不存在",
  DELIVERY_ALREADY_FINISHED: "交付订单已经结束",
  DELIVERY_RESULT_NOT_EXPECTED: "该订单尚未下发 Cookie 数据",
  SUBSCRIPTION_GUARD_REQUIRED: "尚未完成订阅状态检查",
  DELIVERY_EXPIRED: "交付订单已过期",
  RESULT_IDENTITY_MISMATCH: "结果邮箱与订单 Session 不一致",
  REQUEST_INVALID: "请求参数无效",
  REQUEST_TOO_LARGE: "请求正文超过大小限制",
  UNSUPPORTED_MEDIA_TYPE: "请求格式不受支持",
  SESSION_INVALID: "Session 解密或解析失败",
  SESSION_COOKIE_MISSING: "Session 缺少可写入浏览器的 sessionToken",
  EXPECTED_IDENTITY_MISSING: "Session 或 Cookie 响应缺少有效邮箱",
  CONVERTER_IDENTITY_MISMATCH: "Session 与 Cookie 响应邮箱不一致",
  COOKIE_PAYLOAD_INVALID: "Cookie 数据无效",
  CONVERTER_NOT_CONFIGURED: "Cookie 转换服务尚未配置",
  CONVERTER_AUTH_FAILED: "Cookie 转换服务鉴权失败",
  CONVERTER_RATE_LIMITED: "Cookie 转换服务请求过于频繁",
  CONVERTER_RESPONSE_TOO_LARGE: "Cookie 转换服务响应过大",
  CONVERTER_CONTRACT_DRIFT: "Cookie 转换服务接口格式已变化",
  CONVERTER_UNAVAILABLE: "Cookie 转换服务暂时不可用",
  CONVERTER_RESPONSE_INVALID: "Cookie 转换服务响应无效",
  CONVERTER_TIMEOUT: "Cookie 转换服务请求超时",
  COOKIE_OPERATION_FAILED: "Cookie 写入失败",
  CHATGPT_SESSION_VERIFY_RATE_LIMITED: "ChatGPT 登录状态验证请求过于频繁",
  CHATGPT_SESSION_VERIFY_UNAVAILABLE: "ChatGPT 登录状态验证服务暂时不可用",
  CHATGPT_SESSION_VERIFY_TIMEOUT: "ChatGPT 登录状态验证超时",
  CHATGPT_PAGE_RELOAD_FAILED: "ChatGPT 页面刷新失败",
  COOKIE_SCHEMA_UNSUPPORTED: "Cookie 格式不受支持",
  COOKIE_PAYLOAD_REJECTED: "Cookie 数据被浏览器拒绝",
  COOKIE_ROLLBACK_FAILED: "Cookie 回滚失败",
  SUBSCRIPTION_CHECK_FAILED: "订阅状态查询暂时失败",
  SUBSCRIPTION_CANCEL_FAILED: "欠费账号自动续费取消失败",
  SUBSCRIPTION_GUARD_UNAVAILABLE: "订阅保护接口暂时不可用",
  CDKEY_VOIDED: "关联卡密已由后台作废",
  CHATGPT_SESSION_UNAUTHORIZED: "ChatGPT Session 已失效",
  CHATGPT_SESSION_REFRESH_FAILED: "ChatGPT Session 暂时无法刷新，系统将自动重试",
  CHATGPT_SESSION_IDENTITY_MISMATCH: "ChatGPT Session 账号与订单账号不一致",
	CHATGPT_ACCOUNT_ALREADY_SUBSCRIBED: "ChatGPT 账号已有有效付费订阅",
	CHATGPT_IDENTITY_MISSING: "无法获取 ChatGPT 账号邮箱",
	CHATGPT_IDENTITY_MISMATCH: "ChatGPT 账号邮箱与订单不一致",
	HEADLESS_BROWSER_UNAVAILABLE: "Go 结账浏览器不可用",
	CHECKOUT_EXECUTION_WAIT: "等待 Go 执行结账",
	CHECKOUT_PAGE_TIMEOUT: "Go 加载结账页面超时",
	CHECKOUT_ENTRY_UNAVAILABLE: "Go 无法进入 Plus 结账页",
	CHECKOUT_PAGE_UNAVAILABLE: "Go 无法读取结账页面",
	CHECKOUT_UI_UNSUPPORTED: "当前结账页面结构暂不支持自动处理",
	CANARY_AUTHORIZATION_REQUIRED: "等待管理员确认本次 Canary 操作",
	CHECKOUT_BROKER_NOT_CONFIGURED: "旧版结账代理 Token 未配置（当前 Go 流程不使用）",
	CHECKOUT_BROKER_AUTH_FAILED: "旧版结账代理鉴权失败（当前 Go 流程不使用）",
	CHECKOUT_API_AUTH_FAILED: "ChatGPT 官方结账接口拒绝当前登录会话",
	CHECKOUT_API_CONTRACT_DRIFT: "ChatGPT 官方结账接口格式已变化",
	CHECKOUT_CONTEXT_INVALID: "结账页面来源不受信任",
	CHECKOUT_ACTION_STATE_CHANGED: "结账操作状态已变化",
	SECURITY_CHALLENGE_REQUIRED: "结账需要人工安全验证",
	CLOUDFLARE_CHALLENGE_REQUIRED: "等待人工完成 Cloudflare 安全验证",
	SECURITY_CHALLENGE_HANDOFF_FAILED: "安全验证页面接管失败",
	SECURITY_CHALLENGE_TIMEOUT: "人工安全验证等待超时",
	INTERACTIVE_LOGIN_REQUIRED: "等待管理员在临时浏览器完成登录并进入 Plus 结账页",
	INTERACTIVE_LOGIN_DISABLED: "服务器未启用可视登录浏览器",
	INTERACTIVE_LOGIN_HANDOFF_FAILED: "人工登录页面接管失败",
	INTERACTIVE_LOGIN_TIMEOUT: "人工登录或进入结账页等待超时",
	INTERACTIVE_LOGIN_IDENTITY_MISMATCH: "登录账号与订单账号不一致",
	INTERACTIVE_LOGIN_IDENTITY_UNVERIFIED: "无法核对当前浏览器登录账号"
};

const MEMBERSHIP_FULFILLMENT_STATUS_LABELS = {
	waiting_session_validation: "等待 Go 校验登录会话",
  waiting_session_activation: "等待登录会话激活",
  queued: "已排队",
  account_fulfillment_wait: "等待同账号前序订单",
  account_checking: "正在检查订阅状态",
  account_repurchase_not_ready: "账号暂不可续购",
  account_already_subscribed: "账号已订阅",
  inventory_not_ready: "卡片库存未就绪",
  inventory_checking: "正在检查卡片库存",
  card_price_unavailable: "卡片价格不可用",
	checkout_preflight_ready: "等待 Go 注入 Session 并预检结账页",
	checkout_challenge_wait: "等待人工完成安全验证",
	checkout_session_login_wait: "等待在订单浏览器内重新登录",
	checkout_login_ready: "等待 Go 打开人工登录页",
	checkout_login_wait: "等待人工登录并进入 Plus 结账页",
	checkout_login_preflight_passed: "人工登录预检通过（未进入资金流程）",
	checkout_execution_wait: "等待 Go 执行结账",
  browser_lease_wait: "等待扩展接管",
  card_reserved: "卡片已预留",
  initial_checkout_preflight: "正在预检初始结账页",
  checkout_address_unavailable: "账单地址不可用",
  checkout_price_unrecognized: "无法识别结账价格",
  checkout_ui_unsupported: "不支持当前结账页面",
  funding_ready: "资金准备就绪",
  platform_balance_insufficient: "平台余额不足",
  funding: "正在为卡片充值",
  funding_outcome_unknown: "卡片充值结果待确认",
  plus_approval_wait: "Plus 付款等待批准",
  plus_checkout_ready: "Plus 结账页已就绪",
  plus_submit_permitted: "Plus 付款已获准",
  plus_reconciling: "正在确认 Plus 付款",
  plus_confirmed: "Plus 已确认",
  upgrade_checkout_preflight: "正在预检升级结账页",
  upgrade_checkout_unavailable: "升级结账页不可用",
  upgrade_approval_wait: "升级付款等待批准",
  upgrade_checkout_ready: "升级结账页已就绪",
  upgrade_submit_permitted: "升级付款已获准",
  upgrade_reconciling: "正在确认升级付款",
  final_tier_confirmed: "目标套餐已确认",
  renewal_cancelling: "正在取消自动续费",
  checkout_pre_submit_failed: "结账页创建失败",
  unexpected_preauth: "出现意外预授权",
  payment_action_required: "付款需要额外操作",
  action_required_context_lost: "额外操作页面已丢失",
  payment_outcome_uncertain: "付款结果待确认",
	executor_outcome_uncertain: "执行器结果不确定，等待人工核对",
	session_recovery_required: "等待客户重新提交 Session",
	session_recovery_reconciling: "正在核对恢复后的付款状态",
	session_recovery_evidence_hold: "恢复后发现付款证据，等待人工核对",
  payment_declined: "付款被拒绝",
  partially_fulfilled: "部分履约完成",
  partial_fulfillment_expired: "部分履约已超时",
  membership_contract_unknown: "无法确认会员套餐",
  cancelled: "卡密已作废",
  completed: "履约完成"
};

const MEMBERSHIP_INVENTORY_LABELS = {
  not_started: "尚未初始化",
  running: "进行中",
  discovering: "正在发现卡片",
  reconciling: "正在对账",
  completed: "已完成",
  full: "全量初始化",
  refresh: "全量刷新",
  targeted: "定向对账",
  active: "正常",
  frozen: "已冻结",
  cancelled: "已注销",
  deleted: "已删除",
  missing: "上游卡片不存在",
  pending: "等待处理",
  ready: "对账完成",
  hold: "暂挂",
  available: "可用",
  capacity_full: "容量已满",
  refunded_fulfillment: "存在已退款的会员履约",
  pending_settlement: "等待交易结算",
  unclassifiable_openai_payment: "无法分类的 OpenAI 支付",
  upgrade_pair_missing: "缺少对应的 Plus 升级付款",
  mixed_membership_lanes: "存在混用的会员类型",
  mixed_final_tiers: "存在多个最终会员类型",
  capacity_exceeded: "已超过卡片容量",
  upstream_card_missing: "上游卡片不存在",
  card_sync_rejected: "卡片同步连续失败",
  webhook_recheck_pending: "等待重新对账",
  card_transaction_pagination_exceeded: "卡片交易记录超过安全分页上限",
  managed_card_not_found: "本地卡片记录不存在",
  spacexcard_operation_rejected: "SpaceX Card 拒绝同步",
  inventory_card_sync_failed: "卡片同步失败"
};

const MEMBERSHIP_PROCESSOR_STATUS_LABELS = {
  active: "运行中",
  standby: "维护待机",
  stale: "心跳已超时",
  stopped: "已停止",
  error: "异常停止"
};

const SUB2API_REBATE_STATUS_LABELS = {
  pending: "待审核",
  approved: "已到账",
  rejected: "已驳回",
  revoked: "已撤销"
};

const SUB2API_SOURCE_TYPE_LABELS = {
  redeem_code: "兑换码"
};

const SUB2API_REBATE_ACTION_LABELS = {
  approve: "通过",
  reject: "驳回",
  revoke: "撤销"
};

const SUB2API_MONITOR_STATUS_LABELS = {
  operational: "正常",
  degraded: "波动",
  failed: "失败",
  error: "异常",
  unknown: "未知"
};

const SUB2API_MONITOR_PROVIDER_LABELS = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini"
};

function getStatusLabel(value, labels = STATUS_LABELS) {
  const normalized = String(value || "").toLowerCase();
  return labels[normalized] || value || "-";
}

function renderStatus(value, labels = STATUS_LABELS) {
  return `<span class="table-badge status-${String(value || "").toLowerCase()}">${escapeHtml(getStatusLabel(value, labels))}</span>`;
}

function renderStatusText(value) {
  return getStatusLabel(value);
}

function getMembershipFulfillmentStatusLabel(value) {
  return getStatusLabel(value, MEMBERSHIP_FULFILLMENT_STATUS_LABELS);
}

function renderMembershipFulfillmentStatus(value) {
  const state = String(value || "");
  return `<span class="table-badge status-${state.toLowerCase()}" title="${escapeHtml(`状态码：${state || "-"}`)}">${escapeHtml(getMembershipFulfillmentStatusLabel(state))}</span>`;
}

function getMembershipInventoryLabel(value) {
  return getStatusLabel(value, MEMBERSHIP_INVENTORY_LABELS);
}

function getMembershipProcessorStatusLabel(value) {
  return getStatusLabel(value, MEMBERSHIP_PROCESSOR_STATUS_LABELS);
}

function getExtensionDeliveryErrorLabel(value) {
  const normalized = String(value || "").toUpperCase();
  return EXTENSION_DELIVERY_ERROR_LABELS[normalized] || value || "-";
}

function renderExtensionDeliveryError(value) {
  if (!value) return "-";
  return `<span title="${escapeHtml(`错误码：${value}`)}">${escapeHtml(getExtensionDeliveryErrorLabel(value))}</span>`;
}

function renderMembershipInventoryStatus(value) {
  return renderStatus(value, MEMBERSHIP_INVENTORY_LABELS);
}

function setAuthState(isLoggedIn, username = "") {
  refs.loginCard.classList.toggle("hidden", isLoggedIn);
  refs.adminShell.classList.toggle("hidden", !isLoggedIn);
  refs.sessionStatus.textContent = isLoggedIn ? username : "未登录";
}

function switchTab(tabName) {
  currentTab = tabName;
  refs.navItems.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  refs.tabPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== tabName);
  });
  if (tabName === "sms" && getToken()) {
    refreshSmsConsole().catch(() => {});
  }
  if (tabName === "quota" && getToken()) {
    refreshQuotaDashboard().catch(() => {});
    refreshQuotaSubCards().catch(() => {});
    refreshQuotaSourceCards().catch(() => {});
    loadQuotaSettings().catch(() => {});
  }
  if (tabName === "sub2api" && getToken()) {
    refreshSub2ApiConsole().catch(() => {});
  }
  if (tabName === "sub2api-shake" && getToken()) {
    refreshShakeConsole().catch((error) => setHint(refs.shakeCampaignResult, error.message));
  }
  if (tabName === "store-fulfillment" && getToken()) {
    refreshStoreFulfillmentConsole().catch((error) => setHint(refs.storeTaskResult, error.message));
  }
  if (tabName === "extension-delivery" && getToken()) {
    refreshExtensionDeliveryConsole().catch((error) => setHint(refs.extensionDeliverySettingsResult, error.message));
  }
  if (tabName === "membership-fulfillment" && getToken()) {
    refreshMembershipFulfillmentConsole().catch((error) => setHint(refs.membershipFulfillmentSettingsResult, error.message));
  }
  if (tabName === "sub2api-rebates" && getToken()) {
    loadSub2ApiInviterLevels().catch((error) => setHint(refs.sub2apiLevelResult, `加载等级失败：${error.message}`));
    refreshSub2ApiRebates().catch((error) => setHint(refs.sub2apiRebateResult, `加载返利失败：${error.message}`));
  }
  if (tabName === "system" && getToken()) {
    refreshSystemVersion().catch((error) => setHint(refs.systemUpdateHint, error.message));
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = window.setInterval(() => {
    if (document.hidden) return;
    if (currentTab === "dashboard") refreshDashboard().catch(() => {});
    if (currentTab === "logs") refreshLogs().catch(() => {});
  }, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function startUpdatePolling() {
  stopUpdatePolling();
  updatePollTimer = window.setInterval(() => {
    refreshSystemUpdateStatus().catch(() => {});
  }, UPDATE_POLL_INTERVAL_MS);
}

function stopUpdatePolling() {
  if (updatePollTimer) {
    window.clearInterval(updatePollTimer);
    updatePollTimer = null;
  }
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers
    });
  } catch (error) {
    const configHint = API_BASE_CONFIGURED
      ? "请确认该 API 地址可从当前浏览器访问，并且 HTTPS/反代/CORS 配置正确。"
      : "未读取到 runtime-config.js，当前退回默认本机 API 地址；线上请在 .env 配置 API_URL 后执行 npm run config:runtime。";
    throw new Error(`无法连接 API：${API_BASE}。${configHint} 原始错误：${error.message || "Failed to fetch"}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      stopAutoRefresh();
      setAuthState(false);
    }
    const requestError = new Error(payload.message || payload.code || "请求失败");
    requestError.code = payload.code || null;
    throw requestError;
  }
  return payload;
}

function getTablePaginationKey(container) {
  return container?.id || `table-${Math.random().toString(36).slice(2)}`;
}

function getTableState(container) {
  const key = getTablePaginationKey(container);
  if (!tablePaginationState.has(key)) {
    tablePaginationState.set(key, { page: 1, pageSize: DEFAULT_TABLE_PAGE_SIZE });
  }
  return tablePaginationState.get(key);
}

function resetTablePage(container) {
  const state = getTableState(container);
  state.page = 1;
}

function renderPaginationControls(container, state, total, pageRows, options = {}) {
  if (options.paginate === false) return "";
  const pageSize = Math.max(1, state.pageSize || DEFAULT_TABLE_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, state.page || 1), totalPages);
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, (page - 1) * pageSize + pageRows.length);
  const key = getTablePaginationKey(container);
  const pageSizeOptions = TABLE_PAGE_SIZE_OPTIONS.map((size) => `
    <option value="${size}" ${size === pageSize ? "selected" : ""}>${size} / 页</option>
  `).join("");

  return `
    <div class="table-pagination" data-table-pagination="${escapeHtml(key)}">
      <div class="pagination-summary">显示 ${start}-${end} / ${total} 条</div>
      <div class="pagination-actions">
        <label class="pagination-size">
          <span>每页</span>
          <select class="small-select" data-table-page-size="${escapeHtml(key)}">${pageSizeOptions}</select>
        </label>
        <button class="ghost-btn small" type="button" data-table-page="${escapeHtml(key)}" data-page="1" ${page <= 1 ? "disabled" : ""}>首页</button>
        <button class="ghost-btn small" type="button" data-table-page="${escapeHtml(key)}" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
        <span class="pagination-page">第 ${page} / ${totalPages} 页</span>
        <button class="ghost-btn small" type="button" data-table-page="${escapeHtml(key)}" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>
        <button class="ghost-btn small" type="button" data-table-page="${escapeHtml(key)}" data-page="${totalPages}" ${page >= totalPages ? "disabled" : ""}>末页</button>
      </div>
    </div>
  `;
}

function bindTablePagination(container, columns, rows, emptyText, options) {
  if (options.paginate === false) return;
  const key = getTablePaginationKey(container);
  const escapedKey = escapeCssIdentifier(key);
  container.querySelectorAll(`[data-table-page="${escapedKey}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      const state = tablePaginationState.get(key) || { page: 1, pageSize: DEFAULT_TABLE_PAGE_SIZE };
      state.page = Number(button.dataset.page || 1);
      tablePaginationState.set(key, state);
      if (typeof options.onPageChange === "function") {
        options.onPageChange(state.page, state.pageSize);
        return;
      }
      renderTable(container, columns, rows, emptyText, options);
    });
  });
  container.querySelectorAll(`[data-table-page-size="${escapedKey}"]`).forEach((select) => {
    select.addEventListener("change", () => {
      const state = tablePaginationState.get(key) || { page: 1, pageSize: DEFAULT_TABLE_PAGE_SIZE };
      state.page = 1;
      state.pageSize = Number(select.value || DEFAULT_TABLE_PAGE_SIZE);
      tablePaginationState.set(key, state);
      if (typeof options.onPageChange === "function") {
        options.onPageChange(state.page, state.pageSize);
        return;
      }
      renderTable(container, columns, rows, emptyText, options);
    });
  });
}

function renderTable(container, columns, rows, emptyText = "暂无数据", options = {}) {
  if (!container) return;
  const safeRows = Array.isArray(rows) ? rows : [];
  const key = getTablePaginationKey(container);
  const currentState = tablePaginationState.get(key) || { page: 1, pageSize: options.pageSize || DEFAULT_TABLE_PAGE_SIZE };
  if (options.page) currentState.page = Number(options.page);
  if (options.pageSize) currentState.pageSize = Number(options.pageSize);
  tablePaginationState.set(key, currentState);

  const total = Number(options.total ?? safeRows.length);
  const pageSize = Math.max(1, currentState.pageSize || DEFAULT_TABLE_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  currentState.page = Math.min(Math.max(1, currentState.page || 1), totalPages);

  const pageRows = options.paginate === false || options.server === true
    ? safeRows
    : safeRows.slice((currentState.page - 1) * pageSize, currentState.page * pageSize);

  if (!safeRows.length) {
    container.innerHTML = `<p class="hint centered mt-24">${emptyText}</p>`;
    return;
  }

  const head = columns.map((item) => `<th>${item.label}</th>`).join("");
  const body = pageRows.map((row) => `
    <tr>
      ${columns.map((column) => `<td>${column.render(row)}</td>`).join("")}
    </tr>
  `).join("");

  container.innerHTML = `
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    ${renderPaginationControls(container, currentState, total, pageRows, options)}
  `;
  bindTablePagination(container, columns, safeRows, emptyText, options);
}

function closestCard(element) {
  return element?.closest?.(".card") || null;
}

function closestSection(element, selector) {
  return element?.closest?.(selector) || null;
}

function uniqueElements(elements) {
  return Array.from(new Set(elements.filter(Boolean)));
}

function setupModuleSubtabs() {
  const groups = [
    {
      panel: "cards",
      tabs: [
        { id: "create", label: "生成卡密", elements: [closestSection(refs.singleCdkeyForm, ".grid")] },
        { id: "batches", label: "批次历史", elements: [closestCard(refs.batchList)] },
        { id: "cdkeys", label: "卡密明细", elements: [closestCard(refs.cdkeyList)] }
      ]
    },
    {
      panel: "sms",
      tabs: [
        { id: "setup", label: "站点与生成", elements: [closestSection(refs.smsSiteForm, ".grid")] },
        { id: "inventory-import", label: "库存导入", elements: [closestCard(refs.smsBatchForm)] },
        { id: "sites", label: "接码站点", elements: [closestCard(refs.smsSiteList)] },
        { id: "cards", label: "接码卡密", elements: [closestCard(refs.smsCardList)] },
        { id: "orders", label: "接码订单", elements: [closestCard(refs.smsOrderList)] },
        { id: "inventory", label: "库存记录", elements: [closestCard(refs.smsList)] }
      ]
    },
    {
      panel: "jobs",
      tabs: [
        { id: "orders", label: "兑换订单", elements: [closestCard(refs.orderList)] },
        { id: "jobs", label: "激活任务", elements: [closestCard(refs.jobList)] }
      ]
    },
    {
      panel: "subscriptions",
      tabs: [
        { id: "create", label: "新增卡种", elements: [closestCard(refs.subCardTypeForm)] },
        { id: "types", label: "卡种列表", elements: [closestCard(refs.subCardTypeList)] },
        { id: "requests", label: "订阅申请", elements: [closestCard(refs.subRequestList)] }
      ]
    },
    {
      panel: "notifications",
      tabs: [
        { id: "settings", label: "飞书设置", elements: [closestCard(refs.notifySettingsForm)] },
        { id: "form", label: "添加监听", elements: [closestCard(refs.notifyMonitorForm)] },
        { id: "monitors", label: "当前监听", elements: [closestCard(refs.notifyMonitorList)] },
        { id: "events", label: "通知事件", elements: [closestCard(refs.notifyEventList)] }
      ]
    },
    {
      panel: "quota",
      tabs: [
        { id: "overview", label: "概览", elements: [refs.quotaStats, closestCard(refs.quotaApiKeyForm)] },
        { id: "import", label: "卡密导入", elements: [closestCard(refs.quotaImportForm), refs.quotaImportDetailCard] },
        { id: "sources", label: "API 密钥", elements: [closestCard(refs.quotaSourceCardList)] },
        { id: "sub-create", label: "创建子卡密", elements: [closestCard(refs.quotaSubCardForm)] },
        { id: "sub-list", label: "子卡密", elements: [closestCard(refs.quotaSubCardList), refs.quotaSubCardDetailCard] },
        { id: "settings", label: "系统设置", elements: [closestCard(refs.quotaSettingsForm)] }
      ]
    },
    {
      panel: "sub2api",
      tabs: [
        { id: "connections", label: "连接管理", elements: [closestCard(refs.sub2apiConnectionForm), closestCard(refs.sub2apiConnectionList)] },
        { id: "help", label: "嵌入说明", elements: [document.querySelector("#sub2api-connection-form")?.closest(".grid")?.querySelector(".card:nth-child(2)")] },
        { id: "upstream-monitor", label: "上游监控", elements: [closestCard(refs.sub2apiUpstreamMonitorList)] },
        { id: "model-routes", label: "模型路由", elements: [closestCard(refs.sub2apiModelRouteList)] },
        { id: "invites", label: "邀请码", elements: [closestCard(refs.sub2apiInviteList)] },
        { id: "plans", label: "套餐", elements: [closestCard(refs.sub2apiPlanForm), closestCard(refs.sub2apiPlanList)] },
        { id: "orders", label: "订单", elements: [closestCard(refs.sub2apiOrderList)] },
        { id: "worldcup-api", label: "世界杯 API", elements: [closestCard(refs.worldCupApiSettingsForm)] },
        { id: "worldcup-matches", label: "比赛", elements: [closestSection(refs.worldCupMatchForm, ".grid"), closestCard(refs.worldCupMatchList)] },
        { id: "worldcup-bets", label: "竞猜", elements: [closestCard(refs.worldCupBetList)] }
      ]
    },
    {
      panel: "system",
      tabs: [
        { id: "update", label: "系统更新", elements: [document.querySelector("#system-update-section")] },
        { id: "projects", label: "扩展项目", elements: [document.querySelector("#system-projects-section")] }
      ]
    }
  ];

  for (const group of groups) {
    const panel = document.querySelector(`.tab-panel[data-panel="${group.panel}"]`);
    const header = panel?.querySelector(".content-header");
    if (!panel || !header || header.querySelector(".module-tabs")) continue;
    const tabs = group.tabs
      .map((tab) => ({ ...tab, elements: uniqueElements(tab.elements) }))
      .filter((tab) => tab.elements.length);
    if (tabs.length < 2) continue;

    const tabBar = document.createElement("div");
    tabBar.className = "module-tabs";
    tabBar.innerHTML = tabs.map((tab, index) => `
      <button class="module-tab ${index === 0 ? "active" : ""}" type="button" data-module-tab="${escapeHtml(group.panel)}:${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</button>
    `).join("");
    header.appendChild(tabBar);

    const showTab = (tabId) => {
      tabs.forEach((tab) => {
        const active = tab.id === tabId;
        tab.elements.forEach((element) => element.classList.toggle("hidden", !active));
      });
      tabBar.querySelectorAll(".module-tab").forEach((button) => {
        button.classList.toggle("active", button.dataset.moduleTab === `${group.panel}:${tabId}`);
      });
    };

    tabBar.addEventListener("click", (event) => {
      const button = event.target.closest(".module-tab");
      if (!button) return;
      const tabId = button.dataset.moduleTab.split(":")[1];
      showTab(tabId);
    });
    showTab(tabs[0].id);
  }
}

function populateSiteSelects(items) {
  const currentBatch = refs.batchSite.value;
  const currentSingle = refs.singleSite.value;
  const options = [`<option value="">选择网站</option>`].concat(
    items.map((item) => `<option value="${item.id}">${item.name}${item.status === "active" ? "" : "（已禁用）"}</option>`)
  );
  refs.batchSite.innerHTML = options.join("");
  refs.singleSite.innerHTML = options.join("");

  const supportSite = items.find((item) => item.slug === "meimei_site");
  refs.batchSite.value = currentBatch || supportSite?.id || "";
  refs.singleSite.value = currentSingle || supportSite?.id || "";
}

async function refreshDashboard() {
  const payload = await api("/api/admin/dashboard");
  const labels = {
    websites: "网站数量",
    cdkeys: "卡密总量",
    inProgressJobs: "进行中任务",
    failedJobs: "失败任务",
    succeededJobs: "成功任务"
  };

  refs.stats.innerHTML = Object.entries(payload.counts).map(([label, value]) => `
    <article class="stat">
      <span>${labels[label] || label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");

  renderTable(refs.dashboardLogs, [
    { label: "时间", render: (item) => item.created_at },
    { label: "动作", render: (item) => `<code>${item.action}</code>` },
    { label: "资源", render: (item) => `${item.resource_type}${item.resource_id ? ` / ${item.resource_id}` : ""}` },
    { label: "执行人", render: (item) => item.actor }
  ], payload.recentLogs || [], "暂无最近日志");
}

function renderHealthDot(result, key) {
  if (!result) return `<span class="health-dot health-unknown" title="未检测"></span>`;
  const data = typeof result === "string" ? JSON.parse(result) : result;
  const entry = data[key];
  if (!entry || entry.skipped) return `<span class="health-dot health-unknown" title="未配置"></span>`;
  if (entry.ok) return `<span class="health-dot health-ok" title="可达 ${entry.latencyMs}ms"></span>`;
  return `<span class="health-dot health-fail" title="不可达${entry.error ? ` (${entry.error})` : ""}"></span>`;
}

async function toggleSiteStatus(siteId, currentStatus) {
  const newStatus = currentStatus === "active" ? "disabled" : "active";
  try {
    await api(`/api/admin/sites/${siteId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: newStatus })
    });
    await refreshSites();
  } catch (error) {
    setHint(refs.siteResult, error.message);
  }
}

async function healthCheckSite(siteId) {
  try {
    setHint(refs.siteResult, "正在检测...");
    await api(`/api/admin/sites/${siteId}/health-check`, {
      method: "POST",
      body: JSON.stringify({})
    });
    await refreshSites();
    setHint(refs.siteResult, "检测完成。");
  } catch (error) {
    setHint(refs.siteResult, error.message);
  }
}

async function healthCheckAll() {
  const payload = await api("/api/admin/sites");
  const items = payload.items || [];
  setHint(refs.siteResult, `正在逐个检测 ${items.length} 个站点...`);
  for (const site of items) {
    try {
      await api(`/api/admin/sites/${site.id}/health-check`, {
        method: "POST",
        body: JSON.stringify({})
      });
    } catch (_) {}
  }
  await refreshSites();
  setHint(refs.siteResult, "全部检测完成。");
}

async function refreshSites() {
  const payload = await api("/api/admin/sites");
  populateSiteSelects(payload.items);
  renderTable(refs.siteList, [
    { label: "网站名", render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><code style="font-size:10px;opacity:0.6">${escapeHtml(item.slug)}</code>` },
    { label: "接口地址", render: (item) => `
      <div class="health-group">
        <div>${renderHealthDot(item.last_health_result, "verify")} 验证: <code style="font-size:11px">${escapeHtml(item.verify_api_url || "-")}</code></div>
        <div>${renderHealthDot(item.last_health_result, "submit")} 提交: <code style="font-size:11px">${escapeHtml(item.submit_api_url || "-")}</code></div>
      </div>
    ` },
    { label: "Cookie", render: (item) => `
      <span style="font-size:12px;color:var(--muted)">${item.request_cookies ? "已配置" : "未配置"}</span>
      <button class="ghost-btn small" style="padding:4px 8px;font-size:11px;margin-left:4px" type="button" onclick="editSiteCookies('${escapeHtml(item.id)}', ${escapeHtml(JSON.stringify(item.request_cookies || ''))})">编辑</button>
    ` },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "最后检测", render: (item) => `<span style="font-size:12px;color:var(--muted)">${item.last_health_check || "-"}</span>` },
    { label: "操作", render: (item) => `
      <button class="primary-btn small" type="button" onclick="toggleSiteStatus('${escapeHtml(item.id)}', '${escapeHtml(item.status)}')">
        ${item.status === "active" ? "禁用" : "启用"}
      </button>
      <button class="ghost-btn small" style="padding: 6px 12px; font-size:13px" type="button" onclick="healthCheckSite('${escapeHtml(item.id)}')">测活</button>
    ` }
  ], payload.items, "暂无网站数据");
}

async function editSiteCookies(siteId, currentCookies) {
  const value = window.prompt(
    "输入该站点的请求 Cookie（如 cf_clearance=xxx），留空则清除：",
    currentCookies || ""
  );
  if (value === null) return;
  try {
    await api(`/api/admin/sites/${siteId}/cookies`, {
      method: "PATCH",
      body: JSON.stringify({ requestCookies: value })
    });
    setHint(refs.siteResult, value ? "Cookie 已保存" : "Cookie 已清除");
    await refreshSites();
  } catch (error) {
    setHint(refs.siteResult, error.message);
  }
}

window.editSiteCookies = editSiteCookies;

// Global exposure for onclick handlers
window.toggleSiteStatus = toggleSiteStatus;
window.healthCheckSite = healthCheckSite;

async function updateCdkeyEmailToken(id, currentValue) {
  const value = window.prompt(
    "输入该卡密关联的 email_token，留空可清除绑定：",
    currentValue || ""
  );
  if (value === null) return;
  try {
    await api(`/api/admin/cdkeys/${id}/email-token`, {
      method: "PATCH",
      body: JSON.stringify({ emailToken: value })
    });
    await refreshCdkeys();
  } catch (error) {
    alert(error.message);
  }
}

window.updateCdkeyEmailToken = updateCdkeyEmailToken;

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("剪贴板写入被拒绝");
}

async function copyCdkeySession(id, publicKey) {
  try {
    const payload = await api(`/api/admin/cdkeys/${encodeURIComponent(id)}/session`);
    await copyTextToClipboard(payload.sessionJson || "");
    setHint(refs.singleCdkeyResult, `已复制 ${publicKey || payload.publicKey || "卡密"} 的 Session JSON`);
  } catch (error) {
    alert(error.message || "复制失败");
  }
}

window.copyCdkeySession = copyCdkeySession;

async function refreshBatches() {
  const payload = await api("/api/admin/batches");
  renderTable(refs.batchList, [
    { label: "批次", render: (item) => item.name },
    { label: "网站", render: (item) => item.site_name || "-" },
    { label: "前缀", render: (item) => `<code>${item.prefix}</code>` },
    { label: "数量", render: (item) => item.imported_count },
    { label: "创建人", render: (item) => item.created_by }
  ], payload.items, "暂无批次数据");
}

async function refreshCdkeys() {
  const params = new URLSearchParams();
  const keyword = refs.cdkeyFilterKeyword?.value?.trim();
  if (keyword) params.set("q", keyword);
  const payload = await api(`/api/admin/cdkeys${params.toString() ? `?${params.toString()}` : ""}`);
  const originLabels = {
    store_order: "商城订单签发",
    batch_import: "批量导入",
    admin_create: "后台创建"
  };
  renderTable(refs.cdkeyList, [
    { label: "", render: (item) => `<input type="checkbox" class="cdkey-check" value="${item.id}" />` },
    { label: "卡密", render: (item) => `<code>${escapeHtml(item.public_key)}</code>` },
    { label: "类型", render: (item) => item.processing_mode === "manual"
      ? `<span class="table-badge status-processing">人工 ${escapeHtml(item.manual_type || "")}</span>`
      : item.support_only ? `<span class="table-badge status-pending">接码专用</span>` : `<span class="table-badge status-active">普通</span>` },
    { label: "来源", render: (item) => escapeHtml(originLabels[item.origin] || item.origin || "-") },
    { label: "商城订单号", render: (item) => item.store_order_no ? `<code>${escapeHtml(item.store_order_no)}</code>` : "-" },
    { label: "交付子单号", render: (item) => item.store_fulfillment_target_no && item.store_fulfillment_target_no !== item.store_order_no
      ? `<code>${escapeHtml(item.store_fulfillment_target_no)}</code>` : "-" },
    { label: "兑换订单号", render: (item) => item.latest_order_no ? `<code>${escapeHtml(item.latest_order_no)}</code>` : "-" },
    { label: "原始卡密", render: (item) => item.source_key ? `<code style="opacity:0.5">${escapeHtml(item.source_key)}</code>` : "-" },
    { label: "网站", render: (item) => escapeHtml(item.site_name || "-") },
    { label: "前缀", render: (item) => escapeHtml(item.prefix || "-") },
    { label: "接码Token", render: (item) => `
      <div style="display:grid;gap:6px;">
        <span style="font-size:12px;color:var(--muted)">${item.has_email_token ? `<code>${escapeHtml(maskToken(item.email_token))}</code>` : "未绑定"}</span>
        <button class="ghost-btn small" type="button" onclick='updateCdkeyEmailToken(${JSON.stringify(item.id)}, decodeURIComponent(${JSON.stringify(encodeURIComponent(item.email_token || ""))}))'>
          ${item.has_email_token ? "编辑接码 Token" : "绑定接码 Token"}
        </button>
      </div>
    ` },
    { label: "状态", render: (item) => `
      <div style="display:grid;gap:8px;justify-items:start;">
        ${renderStatus(item.status)}
        ${item.status === "used" || item.status === "locked"
          ? `<button class="ghost-btn small" type="button" onclick='copyCdkeySession(${JSON.stringify(item.id)}, ${JSON.stringify(item.public_key)})'>复制 Session</button>`
          : ""}
      </div>
    ` }
  ], payload.items);
}

async function refreshStoreSettings() {
  const payload = await api("/api/admin/store-fulfillment/settings");
  const settings = payload.settings || {};
  refs.storeBaseUrl.value = settings.baseUrl || "";
  refs.storeAdminUsername.value = settings.adminUsername || "";
  refs.storeAdminPassword.value = "";
  refs.storeAdminPassword.placeholder = settings.hasAdminPassword ? "已保存；留空保持原密码" : "首次配置必须填写";
  refs.storePollInterval.value = String(settings.pollIntervalSeconds || 30);
  refs.storeEnabled.value = settings.enabled ? "true" : "false";
  const syncText = settings.lastSyncAt
    ? `最近同步：${settings.lastSyncAt}（${settings.lastSyncStatus || "unknown"}${settings.lastSyncError ? `：${settings.lastSyncError}` : ""}）`
    : "尚未同步";
  const testText = settings.lastTestAt
    ? `；最近测试：${settings.lastTestAt}（${settings.lastTestStatus || "unknown"}${settings.lastTestError ? `：${settings.lastTestError}` : ""}）`
    : "";
  setHint(refs.storeSettingsStatus, syncText + testText);
}

async function refreshStoreSites() {
  const payload = await api("/api/admin/sites");
  const current = refs.storeSiteId.value;
  refs.storeSiteId.innerHTML = (payload.items || []).map((item) => `
    <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.status === "active" ? "" : "（已停用）"}</option>
  `).join("");
  if (current && (payload.items || []).some((item) => item.id === current)) refs.storeSiteId.value = current;
}

function resetStoreMappingForm() {
  refs.storeMappingForm.reset();
  refs.storeMappingId.value = "";
  refs.storeMappingFormTitle.textContent = "添加商品映射";
  refs.storeSkuId.value = "0";
  refs.storeManualType.value = "PLUS";
  refs.storeFulfillmentKind.value = "membership_auto";
  refs.storeSpaceXPlan.value = "plus";
  refs.storePrefix.value = "PLUS";
  refs.storeMappingEnabled.value = "true";
  refs.storeMappingCancelBtn.classList.add("hidden");
  syncStoreMappingKind();
}

function syncStoreMappingKind() {
  const spacex = refs.storeFulfillmentKind.value === "spacex_cdk";
  refs.storeSpaceXPlan.disabled = !spacex;
  refs.storeManualType.disabled = spacex;
  refs.storePrefix.readOnly = spacex;
  if (spacex) {
    const plan = refs.storeSpaceXPlan.value;
    refs.storePrefix.value = { plus: "91GPTPLUS", pro_5x: "91GPT5X", pro_20x: "91GPT20X" }[plan] || "91GPTPLUS";
    refs.storeManualType.value = { plus: "PLUS", pro_5x: "x5", pro_20x: "x20" }[plan] || "PLUS";
  }
}

async function refreshStoreMappings() {
  const payload = await api("/api/admin/store-fulfillment/mappings");
  storeMappingsCache = payload.items || [];
  renderTable(refs.storeMappingList, [
    { label: "商品 / SKU", render: (item) => `<code>${escapeHtml(item.productId)}</code> / <code>${escapeHtml(item.skuId)}</code><br/><span class="hint">${escapeHtml(item.productTitle || "-")}</span>` },
    { label: "履约类型", render: (item) => item.fulfillmentKind === "spacex_cdk"
      ? `<span class="table-badge status-processing">SpaceX CDK / ${escapeHtml(item.spacexPlan)}</span>`
      : (item.fulfillmentKind === "membership_auto"
        ? `<span class="table-badge status-processing">EfunCard 自动化 / ${escapeHtml(item.manualType)}</span>`
        : `<span class="table-badge status-processing">人工 / ${escapeHtml(item.manualType)}</span>`) },
    { label: "KaWang 站点", render: (item) => escapeHtml(item.siteName || item.siteId) },
    { label: "前缀", render: (item) => `<code>${escapeHtml(item.prefix)}</code>` },
    { label: "状态", render: (item) => renderStatus(item.enabled ? "active" : "disabled") },
    { label: "操作", render: (item) => `
      <div class="actions-row">
        <button class="ghost-btn small" type="button" onclick='editStoreMapping(${JSON.stringify(item.id)})'>编辑</button>
        <button class="ghost-btn small" type="button" style="color:var(--error)" onclick='deleteStoreMapping(${JSON.stringify(item.id)})'>删除</button>
      </div>
    ` }
  ], storeMappingsCache, "暂无商品映射");
}

function editStoreMapping(id) {
  const item = storeMappingsCache.find((entry) => entry.id === id);
  if (!item) return;
  refs.storeMappingId.value = item.id;
  refs.storeProductId.value = item.productId;
  refs.storeSkuId.value = item.skuId;
  refs.storeProductTitle.value = item.productTitle || "";
  refs.storeFulfillmentKind.value = item.fulfillmentKind || "manual";
  refs.storeSpaceXPlan.value = item.spacexPlan || "plus";
  refs.storeManualType.value = item.manualType;
  refs.storeSiteId.value = item.siteId;
  refs.storePrefix.value = item.prefix;
  refs.storeMappingEnabled.value = item.enabled ? "true" : "false";
  syncStoreMappingKind();
  refs.storeMappingFormTitle.textContent = "编辑商品映射";
  refs.storeMappingCancelBtn.classList.remove("hidden");
  refs.storeMappingForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteStoreMapping(id) {
  if (!window.confirm("确认删除该商品映射？已创建任务仍保留映射快照。")) return;
  try {
    await api(`/api/admin/store-fulfillment/mappings/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshStoreMappings();
    setHint(refs.storeMappingResult, "商品映射已删除");
  } catch (error) {
    setHint(refs.storeMappingResult, error.message);
  }
}

function storeTaskProducts(task) {
  return (task.items || []).map((item) => `${item.title || "未命名商品"} (${item.productId}/${item.skuId}) × ${item.quantity}`).join("；");
}

async function refreshStoreTasks() {
  const params = new URLSearchParams();
  if (refs.storeTaskStatusFilter.value) params.set("status", refs.storeTaskStatusFilter.value);
  if (refs.storeTaskQuery.value.trim()) params.set("q", refs.storeTaskQuery.value.trim());
  const payload = await api(`/api/admin/store-fulfillment/tasks${params.toString() ? `?${params.toString()}` : ""}`);
  storeTasksCache = payload.items || [];
  renderTable(refs.storeTaskList, [
    { label: "商城订单", render: (item) => `<code>${escapeHtml(item.parentOrderNo)}</code>${item.remoteOrderNo !== item.parentOrderNo ? `<br/><span class="hint">子单 <code>${escapeHtml(item.remoteOrderNo)}</code></span>` : ""}` },
    { label: "商品", render: (item) => `<span title="${escapeHtml(storeTaskProducts(item))}">${escapeHtml(storeTaskProducts(item) || "-")}</span>` },
    { label: "映射快照", render: (item) => (item.mappingSnapshot || []).length
      ? (item.mappingSnapshot || []).map((mapping) => `${mapping.fulfillmentKind === "spacex_cdk"
        ? `SpaceX ${escapeHtml(mapping.spacexPlan)}`
        : (mapping.fulfillmentKind === "membership_auto" ? `EfunCard ${escapeHtml(mapping.manualType)}` : escapeHtml(mapping.manualType))} / ${escapeHtml(mapping.siteName || mapping.siteId)} / <code>${escapeHtml(mapping.prefix)}</code>`).join("<br/>")
      : "-" },
    { label: "CDK", render: (item) => (item.cdkeys || []).length
      ? (item.cdkeys || []).map((card) => `<code>${escapeHtml(card.publicKey)}</code>`).join("<br/>")
      : "-" },
    { label: "状态", render: (item) => `${renderStatus(item.status)}<br/><span class="hint">尝试 ${item.attemptCount}</span>` },
    { label: "最后错误", render: (item) => item.lastError ? `<span style="color:var(--error)" title="${escapeHtml(item.lastError)}">${escapeHtml(item.lastError)}</span>` : "-" },
    { label: "时间", render: (item) => `<span class="hint">创建 ${escapeHtml(item.createdAt || "-")}<br/>完成 ${escapeHtml(item.completedAt || item.canceledAt || "-")}</span>` },
    { label: "操作", render: (item) => `
      <div class="actions-row">
        ${(item.cdkeys || []).length ? `<button class="ghost-btn small" type="button" onclick='copyStoreTaskCdkeys(${JSON.stringify(item.id)})'>复制 CDK</button>` : ""}
        ${!["succeeded", "canceled"].includes(item.status) ? `
          <button class="ghost-btn small" type="button" onclick='runStoreTaskAction(${JSON.stringify(item.id)}, "recheck")'>重新检查</button>
          <button class="primary-btn small" type="button" onclick='runStoreTaskAction(${JSON.stringify(item.id)}, "retry")'>重试</button>
        ` : ""}
        ${item.canCancel ? `<button class="danger-btn small" type="button" onclick='cancelStoreTask(${JSON.stringify(item.id)})'>取消交付</button>` : ""}
      </div>
    ` }
  ], storeTasksCache, "暂无商城交付任务");
}

async function copyStoreTaskCdkeys(id) {
  const task = storeTasksCache.find((item) => item.id === id);
  const keys = (task?.cdkeys || []).map((item) => item.publicKey).filter(Boolean);
  if (!keys.length) return;
  try {
    await copyTextToClipboard(keys.join("\n"));
    setHint(refs.storeTaskResult, `已复制 ${keys.length} 张 CDK`);
  } catch (error) {
    setHint(refs.storeTaskResult, error.message || "复制失败");
  }
}

async function runStoreTaskAction(id, action) {
  try {
    await api(`/api/admin/store-fulfillment/tasks/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.storeTaskResult, action === "recheck" ? "任务已加入重新检查队列" : "任务已加入重试队列");
    await refreshStoreTasks();
  } catch (error) {
    setHint(refs.storeTaskResult, error.message);
  }
}

async function cancelStoreTask(id) {
  const adminUsername = refs.spaceXCdkAdminUsername.value.trim();
  const adminPassword = refs.spaceXCdkAdminPassword.value;
  if (!adminUsername || !adminPassword) {
    setHint(refs.storeTaskResult, "请先在 SpaceX 配置表单中输入管理员账号和密码，再取消交付");
    return;
  }
  if (!window.confirm("确认停止这条自动交付任务？已生成但未兑换的 CDK 只有在上游核验为 unused 后才会回收到库存，供后续订单复用。")) return;
  const reason = window.prompt("填写取消原因（至少 3 个字符）", "客户申请取消自动交付");
  if (!reason) return;
  try {
    const payload = await api(`/api/admin/store-fulfillment/tasks/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ adminUsername, adminPassword, reason })
    });
    refs.spaceXCdkAdminPassword.value = "";
    setHint(
      refs.storeTaskResult,
      `自动交付已取消；${payload.canceled?.recycled || 0} 张未兑换资产已回收到库存，仍会优先供下个订单复用`
    );
    await Promise.all([refreshStoreTasks(), refreshSpaceXCdkInventory(), refreshSpaceXCdkSettings()]);
  } catch (error) {
    refs.spaceXCdkAdminPassword.value = "";
    setHint(refs.storeTaskResult, error.message);
  }
}

async function refreshStoreFulfillmentConsole() {
  await Promise.all([refreshStoreSettings(), refreshStoreSites()]);
  await Promise.all([refreshStoreMappings(), refreshStoreTasks(), refreshSpaceXCdkConsole()]);
}

async function refreshSpaceXCdkSettings() {
  const payload = await api("/api/admin/spacex-cdk/settings");
  const settings = payload.settings || {};
  refs.spaceXCdkBaseUrl.value = settings.baseUrl || "https://spacexcard.com";
  refs.spaceXCdkApiKey.value = "";
  refs.spaceXCdkWebhookSecret.value = "";
  refs.spaceXCdkApiKey.placeholder = settings.hasApiKey ? "已保存；留空保持" : "尚未配置";
  refs.spaceXCdkWebhookSecret.placeholder = settings.hasWebhookSecret ? "已保存；留空保持" : "尚未配置";
  refs.spaceXCdkRolloutPlan.value = settings.rolloutPlan || "disabled";
  refs.spaceXCdkEnabled.value = settings.enabled ? "true" : "false";
  refs.spaceXCdkUnlimitedFundingPolicy.value = settings.unlimitedFundingPolicy || "block";
  refs.spaceXCdkAdminPassword.value = "";
  const balance = settings.lastBalanceMinor == null
    ? "尚未读取余额"
    : `余额 ${(Number(settings.lastBalanceMinor) / 100).toFixed(2)} ${settings.balanceCurrency || ""}`;
  const liability = `未兑换负债 ${(Number(settings.outstandingLiabilityMinor || 0) / 100).toFixed(2)} ${settings.balanceCurrency || ""}（${settings.outstandingCount || 0} 张）`;
  const unknown = settings.unknownLiabilityCount ? `；${settings.unknownLiabilityCount} 张缺少可记账资金契约` : "";
  const policy = settings.unlimitedFundingPolicy === "snapshot_budget"
    ? "；无限授权按快照金额记本地负债（上游仍为无限授权）"
    : "；无限授权已拦截";
  setHint(refs.spaceXCdkSettingsStatus, `${settings.enabled ? "履约已启用" : "履约已停用"}；${balance}；${liability}${unknown}${policy}${settings.lastBalanceError ? `；错误：${settings.lastBalanceError}` : ""}`);
}

async function refreshSpaceXCdkInventory() {
  const payload = await api("/api/admin/spacex-cdk/inventory");
  renderTable(refs.spaceXCdkInventoryList, [
    { label: "SpaceX 资产", render: (item) => `<code>${escapeHtml(item.codePrefix)}</code><br/><span class="hint">ID ${escapeHtml(item.upstreamId)}</span>` },
    { label: "套餐", render: (item) => escapeHtml(item.plan) },
    { label: "本地 / 上游状态", render: (item) => `${renderStatus(item.state)}<br/><span class="hint">${escapeHtml(item.upstreamStatus || "-")}</span>` },
    { label: "资金上限", render: (item) => item.fundingContractMode === "snapshot_budgeted"
      ? `<span style="color:var(--warning)">本地预算 ${escapeHtml((Number(item.fundingLiabilityMinor) / 100).toFixed(2))} ${escapeHtml(item.fundingCurrency || "")}（上游无限）</span>`
      : (item.fundingContractMode === "unlimited"
      ? (item.state === "consumed" ? "无限授权（资产已消耗）" : `<span style="color:var(--error)">无限授权（已拦截）</span>`)
      : (item.fundingContractMode !== "bounded" || item.fundingCapMinor == null
        ? `<span style="color:var(--error)">缺少有界额度</span>`
        : `${escapeHtml((Number(item.fundingCapMinor) / 100).toFixed(2))} ${escapeHtml(item.fundingCurrency || "")}`)) },
    { label: "包装 CDK", render: (item) => item.wrapperPublicKey
      ? `<code>${escapeHtml(item.wrapperPublicKey)}</code>`
      : (item.unitState === "manually_closed" ? "未生成（已人工收尾）" : (item.state === "consumed" ? "未生成（资产已消耗）" : "库存待分配")) },
    { label: "操作", render: (item) => `
      <div class="actions-row">
        <button class="ghost-btn small" type="button" onclick='revealSpaceXCdk(${JSON.stringify(item.id)})'>验密查看并复制</button>
        ${item.canSnapshotRecover ? `<button class="primary-btn small" type="button" onclick='recoverSpaceXCdkSnapshotBudget(${JSON.stringify(item.id)})'>按快照预算恢复</button>` : ""}
        ${item.canManualClose ? `<button class="danger-btn small" type="button" onclick='manualCloseSpaceXCdk(${JSON.stringify(item.id)})'>取消自动任务</button>` : ""}
      </div>
    ` }
  ], payload.items || [], "暂无 SpaceX CDK 资产");
}

async function refreshSpaceXCdkActivations() {
  const payload = await api("/api/admin/spacex-cdk/activations");
  renderTable(refs.spaceXCdkActivationList, [
    { label: "订单 / CDK", render: (item) => `${item.orderNo ? `<code>${escapeHtml(item.orderNo)}</code><br/>` : '<span class="hint">尚未生成兑换订单</span><br/>'}<code>${escapeHtml(item.publicKey)}</code>` },
    { label: "套餐 / 账号", render: (item) => `${escapeHtml(item.plan)}<br/><span class="hint">${escapeHtml(item.accountMasked || "-")}</span>` },
    { label: "状态", render: (item) => `${renderStatus(item.state)}<br/><span class="hint">${escapeHtml(item.message || "-")}</span>` },
    { label: "续费保护", render: (item) => {
      const state = item.renewalGuardState || "-";
      const label = {
        passed: "已确认关闭",
        checking: "检查中",
        cancelling: "关闭中",
        account_wait: "等待会员到期",
        retry_wait: "等待重试",
        human_review: "待人工确认"
      }[state] || state;
      const evidence = item.renewalWillRenew === false
        ? "续费已关闭"
        : (item.renewalWillRenew === true ? "仍开启" : "状态未知");
      return `${escapeHtml(label)}<br/><span class="hint">${escapeHtml(evidence)}；尝试 ${escapeHtml(item.renewalAttempts || 0)}/${escapeHtml(Math.max(3, item.renewalAttempts || 0))}<br/>关闭调用 ${escapeHtml(item.renewalCancellationAttempts || 0)} 次${item.renewalLastErrorCode ? `<br/>${escapeHtml(item.renewalLastErrorCode)}` : ""}</span>`;
    } },
    { label: "时间", render: (item) => `<span class="hint">创建 ${escapeHtml(item.createdAt)}<br/>更新 ${escapeHtml(item.updatedAt)}</span>` }
  ], payload.items || [], "暂无 SpaceX 激活记录");
}

async function refreshSpaceXCdkConsole() {
  await Promise.all([refreshSpaceXCdkSettings(), refreshSpaceXCdkInventory(), refreshSpaceXCdkActivations()]);
}

async function revealSpaceXCdk(id) {
  const adminUsername = refs.spaceXCdkAdminUsername.value.trim();
  const adminPassword = refs.spaceXCdkAdminPassword.value;
  if (!adminUsername || !adminPassword) {
    setHint(refs.spaceXCdkSettingsResult, "请先在 SpaceX 配置表单中输入管理员账号和密码，再查看完整码");
    return;
  }
  const reason = window.prompt("填写查看完整 SpaceX CDK 的原因（至少 3 个字符）");
  if (!reason) return;
  try {
    const payload = await api(`/api/admin/spacex-cdk/inventory/${encodeURIComponent(id)}/reveal`, {
      method: "POST",
      body: JSON.stringify({ adminUsername, adminPassword, reason })
    });
    refs.spaceXCdkAdminPassword.value = "";
    await copyTextToClipboard(payload.code);
    setHint(refs.spaceXCdkSettingsResult, `完整 SpaceX CDK 已复制；查看行为已审计（${payload.codePrefix}）`);
  } catch (error) {
    setHint(refs.spaceXCdkSettingsResult, error.message);
  }
}

async function manualCloseSpaceXCdk(id) {
  const adminUsername = refs.spaceXCdkAdminUsername.value.trim();
  const adminPassword = refs.spaceXCdkAdminPassword.value;
  if (!adminUsername || !adminPassword) {
    setHint(refs.spaceXCdkSettingsResult, "请先在 SpaceX 配置表单中输入管理员账号和密码，再取消自动任务");
    return;
  }
  if (!window.confirm("仅当该订单已人工处理，且原始 SpaceX CDK 已经用完时才能继续。确认取消本地自动任务？")) return;
  const reason = window.prompt("填写人工收尾原因（至少 3 个字符）", "订单已人工处理，原始 CDK 已使用");
  if (!reason) return;
  try {
    const payload = await api(`/api/admin/spacex-cdk/inventory/${encodeURIComponent(id)}/manual-close`, {
      method: "POST",
      body: JSON.stringify({ adminUsername, adminPassword, reason })
    });
    refs.spaceXCdkAdminPassword.value = "";
    setHint(refs.spaceXCdkSettingsResult, `自动任务已取消并完成审计（商城订单 ${payload.closed?.remoteOrderNo || "-"}）`);
    await Promise.all([refreshSpaceXCdkInventory(), refreshStoreTasks(), refreshSpaceXCdkSettings()]);
  } catch (error) {
    refs.spaceXCdkAdminPassword.value = "";
    setHint(refs.spaceXCdkSettingsResult, error.message);
  }
}

async function recoverSpaceXCdkSnapshotBudget(id) {
  const adminUsername = refs.spaceXCdkAdminUsername.value.trim();
  const adminPassword = refs.spaceXCdkAdminPassword.value;
  if (!adminUsername || !adminPassword) {
    setHint(refs.spaceXCdkSettingsResult, "请先输入管理员账号和密码，再恢复该资产");
    return;
  }
  if (!window.confirm("确认复用原 SpaceX CDK，并按 funding_snapshot.open_and_balance_minor 记本地负债？上游授权仍是无限额度，操作不会新发码。")) return;
  const reason = window.prompt("填写恢复原因（至少 3 个字符）", "接受上游无限授权风险，复用原 CDK 并继续交付");
  if (!reason) return;
  try {
    const payload = await api(`/api/admin/spacex-cdk/inventory/${encodeURIComponent(id)}/snapshot-recover`, {
      method: "POST",
      body: JSON.stringify({ adminUsername, adminPassword, reason })
    });
    refs.spaceXCdkAdminPassword.value = "";
    setHint(refs.spaceXCdkSettingsResult, `原资产已按快照预算恢复，未新发码；商城订单 ${payload.recovered?.remoteOrderNo || "-"} 已继续自动交付`);
    await Promise.all([refreshSpaceXCdkInventory(), refreshStoreTasks(), refreshSpaceXCdkSettings()]);
  } catch (error) {
    refs.spaceXCdkAdminPassword.value = "";
    setHint(refs.spaceXCdkSettingsResult, error.message);
  }
}

window.editStoreMapping = editStoreMapping;
window.deleteStoreMapping = deleteStoreMapping;
window.copyStoreTaskCdkeys = copyStoreTaskCdkeys;
window.runStoreTaskAction = runStoreTaskAction;
window.revealSpaceXCdk = revealSpaceXCdk;
window.manualCloseSpaceXCdk = manualCloseSpaceXCdk;

async function refreshExtensionDeliverySettings() {
  const payload = await api("/api/admin/extension-delivery/settings");
  const settings = payload.settings || {};
  const sites = payload.sites || [];
  const selected = new Set(settings.allowedSiteSlugs || []);
  refs.extensionDeliveryEnabled.value = settings.enabled ? "true" : "false";
  refs.extensionDeliveryConverterUrl.value = settings.converterUrl || "https://spacexcard.com/api/v1/gpt/session-to-cookie";
  refs.extensionDeliverySpacexcardToken.value = "";
  refs.extensionDeliverySpacexcardToken.placeholder = settings.hasSpacexcardToken
    ? "Token 已加密保存；留空保持不变"
    : "首次配置必须填写";
  refs.extensionDeliveryClearSpacexcardToken.checked = false;
  refs.extensionDeliverySites.innerHTML = sites.map((site) => `
    <option value="${escapeHtml(site.slug)}" ${selected.has(site.slug) ? "selected" : ""}>
      ${escapeHtml(site.name)}（${escapeHtml(site.slug)}）${site.status === "active" ? "" : "－已停用"}
    </option>
  `).join("");

  const currentFilter = refs.extensionDeliverySiteFilter.value;
  refs.extensionDeliverySiteFilter.innerHTML = `<option value="">全部站点</option>${sites.map((site) => `
    <option value="${escapeHtml(site.slug)}">${escapeHtml(site.name)}（${escapeHtml(site.slug)}）</option>
  `).join("")}`;
  if (sites.some((site) => site.slug === currentFilter)) refs.extensionDeliverySiteFilter.value = currentFilter;

  refs.extensionDeliveryConnection.innerHTML = `
    <div>服务：<strong>${settings.enabled ? "已启用" : "已停用"}</strong></div>
    <div>spacexcard Token：<strong>${settings.hasSpacexcardToken ? "已配置" : "未配置"}</strong></div>
    <div>Extension Token：<strong>${settings.hasExtensionToken ? "已生成" : "未生成"}</strong></div>
    <div>绑定实例：<code>${escapeHtml(settings.boundInstallationId || "未绑定")}</code></div>
    <div>扩展在线：<strong>${settings.online ? "在线" : "离线"}</strong></div>
    <div>连接时间：${escapeHtml(settings.connectedAt || "-")}</div>
    <div>最后心跳：${escapeHtml(settings.lastHeartbeatAt || "-")}</div>
    <div>恢复版本：${Number(settings.resumeRevision) || 0}</div>
  `;
  refs.extensionDeliveryGenerateToken.disabled = settings.hasExtensionToken;
  refs.extensionDeliveryResetToken.disabled = !settings.hasExtensionToken;
  refs.extensionDeliveryRevokeToken.disabled = !settings.hasExtensionToken;
}

async function refreshExtensionDeliveries() {
  const params = new URLSearchParams({ limit: "100" });
  if (refs.extensionDeliveryStatusFilter.value) params.set("status", refs.extensionDeliveryStatusFilter.value);
  if (refs.extensionDeliverySiteFilter.value) params.set("siteSlug", refs.extensionDeliverySiteFilter.value);
  const payload = await api(`/api/admin/extension-deliveries?${params.toString()}`);
  renderTable(refs.extensionDeliveryList, [
    { label: "订单号", render: (item) => `<code>${escapeHtml(item.orderNo)}</code>` },
    { label: "站点", render: (item) => escapeHtml(item.siteSlug || "-") },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "尝试", render: (item) => String(Number(item.attempts) || 0) },
    { label: "错误原因", render: (item) => renderExtensionDeliveryError(item.errorCode) },
    { label: "订阅保护", render: (item) => {
      if (!item.subscriptionCheckedAt) return "待检查";
      const renewal = item.renewalCancelledAt
        ? "已取消自动续费"
        : (item.subscriptionWillRenew === false ? "自动续费已关闭" : (item.subscriptionWillRenew === true ? "自动续费开启" : "无续费状态"));
      return `${item.subscriptionDelinquent ? "欠费" : "正常"}<br/><span class="hint">${renewal}<br/>${escapeHtml(item.subscriptionCheckedAt)}</span>`;
    } },
    { label: "创建 / 到期", render: (item) => `<span class="hint">${escapeHtml(item.createdAt || "-")}<br/>${escapeHtml(item.expiresAt || "-")}</span>` },
    { label: "交付 / 更新", render: (item) => `<span class="hint">${escapeHtml(item.deliveredAt || "-")}<br/>${escapeHtml(item.updatedAt || "-")}</span>` },
    { label: "操作", render: (item) => item.status === "pending"
      ? `<button class="ghost-btn small" type="button" onclick='retryExtensionDelivery(${JSON.stringify(item.orderNo)})'>立即重试</button>`
      : "-" }
  ], payload.items || [], "暂无扩展交付记录");
  setHint(refs.extensionDeliveryListResult, payload.nextCursor ? "当前仅显示前 100 条，请使用筛选缩小范围" : "");
}

async function refreshExtensionDeliveryConsole() {
  await refreshExtensionDeliverySettings();
  await refreshExtensionDeliveries();
}

function resetAutomationProviderForm() {
  refs.automationProviderForm?.reset();
  refs.automationProviderId.value = "";
  refs.automationProviderAdapter.value = "automate_v1";
  refs.automationProviderStatus.value = "paused";
  refs.automationProviderApiKey.placeholder = "首次提供一次；后续留空继续使用";
}

function resetAutomationMappingForm() {
  refs.automationMappingForm?.reset();
  refs.automationMappingId.value = "";
  refs.automationMappingCardCapacity.value = "1";
  refs.automationMappingPriority.value = "100";
  updateAutomationCapabilitySelects();
}

function updateAutomationCapabilitySelects() {
  const provider = automationProvidersCache.find((item) => item.id === refs.automationMappingProvider?.value);
  const plans = (provider?.config?.plans || []).filter((item) => item.taskType === "purchase");
  const regions = provider?.config?.regions || [];
  const selectedPlan = refs.automationMappingPlan?.value;
  const selectedRegion = refs.automationMappingRegion?.value;
  refs.automationMappingPlan.innerHTML = plans.map((item) => `
    <option value="${escapeHtml(item.id)}">${escapeHtml(item.label || item.name)}（${escapeHtml(item.id)}）</option>
  `).join("");
  refs.automationMappingRegion.innerHTML = regions.map((item) => `
    <option value="${escapeHtml(item.code)}">${escapeHtml(item.label)} / ${escapeHtml(item.code)} / ${escapeHtml(item.currency)}</option>
  `).join("");
  if (plans.some((item) => item.id === selectedPlan)) refs.automationMappingPlan.value = selectedPlan;
  if (regions.some((item) => item.code === selectedRegion)) refs.automationMappingRegion.value = selectedRegion;
}

function loadAutomationProvider(id) {
  const item = automationProvidersCache.find((provider) => provider.id === id);
  if (!item) return;
  refs.automationProviderId.value = item.id;
  refs.automationProviderName.value = item.name;
  refs.automationProviderAdapter.value = item.adapterKey;
  refs.automationProviderBaseUrl.value = item.baseUrl;
  refs.automationProviderApiKey.value = "";
  refs.automationProviderApiKey.placeholder = item.hasCredential ? "Key 已加密保存；留空保持不变" : "必须提供 Key";
  refs.automationProviderStatus.value = item.status;
  refs.automationProviderForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function loadAutomationMapping(id) {
  const item = automationMappingsCache.find((mapping) => mapping.id === id);
  if (!item) return;
  refs.automationMappingId.value = item.id;
  refs.automationMappingProduct.value = item.storeMappingId || item.productId;
  refs.automationMappingProvider.value = item.providerId;
  updateAutomationCapabilitySelects();
  refs.automationMappingPlan.value = item.externalPlanId;
  refs.automationMappingRegion.value = item.regionCode || "";
  refs.automationMappingCardPlatform.value = item.cardPlatformKey;
  refs.automationMappingCardProduct.value = item.cardProductCode || "";
  refs.automationMappingCapacityKey.value = item.capacityKey;
  refs.automationMappingCardCapacity.value = item.cardCapacity;
  refs.automationMappingFunding.value = item.fundingAmountUsd;
  refs.automationMappingPriceMin.value = item.expectedMinAmount;
  refs.automationMappingPriceMax.value = item.expectedMaxAmount;
  refs.automationMappingDailyRisk.value = item.dailyRiskLimitUsd;
  refs.automationMappingPriority.value = item.priority;
  refs.automationMappingEnabled.checked = item.enabled;
  refs.automationMappingForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function syncAutomationProvider(id) {
  try {
    await api(`/api/admin/automation/providers/${encodeURIComponent(id)}/sync`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.automationProviderResult, "站点 /config 已同步；被移除的能力映射已自动停用");
    await refreshAutomationConsole();
  } catch (error) {
    setHint(refs.automationProviderResult, error.message);
  }
}

async function resetAutomationProviderCircuit(id) {
  if (!window.confirm("确认在排查站点、Key 和价格配置后重置该站点熔断？")) return;
  try {
    await api(`/api/admin/automation/providers/${encodeURIComponent(id)}/reset-circuit`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.automationProviderResult, "站点熔断已重置");
    await refreshAutomationConsole();
  } catch (error) {
    setHint(refs.automationProviderResult, error.message);
  }
}

async function toggleAutomationMapping(id, enabled) {
  try {
    await api(`/api/admin/automation/mappings/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ enabled })
    });
    setHint(refs.automationMappingResult, enabled ? "映射已启用" : "映射已暂停");
    await refreshAutomationConsole();
  } catch (error) {
    setHint(refs.automationMappingResult, error.message);
  }
}

async function queryAutomationExecution(id) {
  try {
    await api(`/api/admin/automation/executions/${encodeURIComponent(id)}/query-now`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.automationExecutionResult, "已安排使用原站点、原 Key 和原任务号立即查询");
    await refreshAutomationConsole();
  } catch (error) {
    setHint(refs.automationExecutionResult, error.message);
  }
}

async function retryAutomationExecution(id) {
  try {
    await api(`/api/admin/automation/executions/${encodeURIComponent(id)}/retry`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.automationExecutionResult, "已安排安全重试；不会越过付款 Gate 或重置远端幂等信息");
    await refreshAutomationConsole();
  } catch (error) {
    setHint(refs.automationExecutionResult, error.message);
  }
}

async function takeOverAutomationExecution(id) {
  if (!window.confirm("确认停止该订单的协议自动化并转为人工处理？接管后必须根据外部证据裁决成功或失败。")) return;
  try {
    await api(`/api/admin/automation/executions/${encodeURIComponent(id)}/manual-review`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.automationExecutionResult, "订单已转为人工处理；完成后请使用裁决成功或裁决失败记录结果");
    await refreshAutomationConsole();
  } catch (error) {
    setHint(refs.automationExecutionResult, error.message);
  }
}

async function resolveAutomationExecution(id, outcome) {
  const evidenceReference = window.prompt("输入外部证据编号（工单号、远端任务号或对账记录编号；不要粘贴 Session 或卡资料）：", "");
  if (!evidenceReference) return;
  const label = outcome === "succeeded" ? "成功并消耗卡密" : "失败并释放卡密";
  if (!window.confirm(`确认根据外部证据将该订单裁决为“${label}”？此操作不可自动撤销。`)) return;
  try {
    await api(`/api/admin/automation/executions/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ outcome, evidenceReference, confirmation: "RESOLVE_AUTOMATION_REVIEW" })
    });
    setHint(refs.automationExecutionResult, `人工裁决已记录：${label}`);
    await refreshAutomationConsole();
  } catch (error) {
    setHint(refs.automationExecutionResult, error.message);
  }
}

async function refreshAutomationConsole() {
  const [settingsPayload, providerPayload, mappingPayload, storeMappingPayload, executionPayload] = await Promise.all([
    api("/api/admin/automation/settings"),
    api("/api/admin/automation/providers"),
    api("/api/admin/automation/mappings"),
    api("/api/admin/store-fulfillment/mappings"),
    api("/api/admin/automation/executions")
  ]);
  automationProvidersCache = providerPayload.items || [];
  automationMappingsCache = mappingPayload.items || [];
  automationStoreMappingsCache = (storeMappingPayload.items || []).filter((item) => (
    item.enabled === true && item.fulfillmentKind === "membership_auto"
  ));
  refs.automationGateEnabled.checked = settingsPayload.paymentGateEnabled === true;
  refs.automationConfigTtl.value = Number(settingsPayload.configTtlSeconds) || 300;
  setHint(
    refs.automationGateResult,
    `${settingsPayload.paymentGateEnabled ? "Gate 已开启" : "Gate 已关闭"}；最近更新 ${settingsPayload.updatedAt || "-"}`
  );

  const selectedProvider = refs.automationMappingProvider.value;
  refs.automationMappingProvider.innerHTML = automationProvidersCache.map((item) => `
    <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} / ${escapeHtml(item.status)}</option>
  `).join("");
  if (automationProvidersCache.some((item) => item.id === selectedProvider)) {
    refs.automationMappingProvider.value = selectedProvider;
  }
  const selectedProduct = refs.automationMappingProduct.value;
  refs.automationMappingProduct.innerHTML = automationStoreMappingsCache.map((item) => `
    <option value="${escapeHtml(item.id)}">${escapeHtml(item.productTitle || item.productId)}（${escapeHtml(item.productId)}/${escapeHtml(item.skuId)} · ${escapeHtml(item.manualType)} · ${escapeHtml(item.siteName || item.siteId)}）</option>
  `).join("");
  if (automationStoreMappingsCache.some((item) => item.id === selectedProduct)) {
    refs.automationMappingProduct.value = selectedProduct;
  }
  updateAutomationCapabilitySelects();

  renderTable(refs.automationProviderList, [
    { label: "站点", render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><code>${escapeHtml(item.baseUrl)}</code>` },
    { label: "协议 / Key", render: (item) => `<code>${escapeHtml(item.adapterKey)}</code><br/><span class="hint">${item.hasCredential ? "Key 已配置" : "Key 未配置"} / 并发 ${item.maxConcurrency}</span>` },
    { label: "能力", render: (item) => `${escapeHtml(item.configStatus)}<br/><span class="hint">套餐 ${(item.config?.plans || []).filter((plan) => plan.taskType === "purchase").length} / 地区 ${(item.config?.regions || []).length}<br/>${escapeHtml(item.configSyncedAt || "-")}</span>` },
    { label: "状态 / 熔断", render: (item) => `${renderStatus(item.status)}<br/><code>${escapeHtml(item.circuitState)}</code><br/><span class="hint">${escapeHtml(item.circuitReason || item.configError || "-")}</span>` },
    { label: "操作", render: (item) => `<button class="ghost-btn small" type="button" onclick='loadAutomationProvider(${JSON.stringify(item.id)})'>编辑</button> <button class="ghost-btn small" type="button" onclick='syncAutomationProvider(${JSON.stringify(item.id)})'>同步配置</button> ${item.circuitState === "open" ? `<button class="ghost-btn small" type="button" onclick='resetAutomationProviderCircuit(${JSON.stringify(item.id)})'>重置熔断</button>` : ""}` }
  ], automationProvidersCache, "尚未配置自动化站点");

  renderTable(refs.automationMappingList, [
    { label: "商城交付商品", render: (item) => item.storeMappingId
      ? `<strong>${escapeHtml(item.productTitle || item.storeProductId)}</strong><br/><code>${escapeHtml(item.storeProductId)}/${escapeHtml(item.storeSkuId)}</code><br/><span class="hint">${escapeHtml(item.storeManualType)} · ${escapeHtml(item.storeSiteName || item.storeSiteId)}</span>`
      : `<strong>原配置待重新选择</strong><br/><code>${escapeHtml(item.productId)}</code>` },
    { label: "站点套餐", render: (item) => `${escapeHtml(item.providerName || item.providerId)}<br/><code>${escapeHtml(item.externalPlanId)}</code>` },
    { label: "区域 / 价格", render: (item) => `${escapeHtml(item.regionCode || "-")} / ${escapeHtml(item.currency || "-")}<br/><span class="hint">${item.expectedMinAmount} - ${item.expectedMaxAmount}</span>` },
    { label: "卡台 / 资金", render: (item) => `${escapeHtml(item.cardPlatformKey)} / ${escapeHtml(item.capacityKey)} × ${item.cardCapacity}<br/><span class="hint">整卡 $${Number(item.fundingAmountUsd).toFixed(2)} / 日上限 $${Number(item.dailyRiskLimitUsd).toFixed(2)}</span>` },
    { label: "路由", render: (item) => `优先级 ${item.priority}<br/>${item.enabled ? renderStatus("active") : renderStatus("paused")}<br/><span class="hint">${escapeHtml(item.pausedReason || "-")}</span>` },
    { label: "操作", render: (item) => `<button class="ghost-btn small" type="button" onclick='loadAutomationMapping(${JSON.stringify(item.id)})'>编辑</button> <button class="ghost-btn small" type="button" onclick='toggleAutomationMapping(${JSON.stringify(item.id)}, ${item.enabled ? "false" : "true"})'>${item.enabled ? "暂停" : "启用"}</button>` }
  ], automationMappingsCache, "尚未配置商城交付商品映射");

  renderTable(refs.automationExecutionList, [
    { label: "订单", render: (item) => `<strong>${escapeHtml(item.orderNo)}</strong><br/><code>${escapeHtml(item.id)}</code>` },
    { label: "状态", render: (item) => `${renderStatus(item.status)}<br/><span class="hint">${escapeHtml(item.currentPhase || "-")}</span>` },
    { label: "站点任务", render: (item) => `<code>${escapeHtml(item.providerId || "-")}</code><br/><span class="hint">${escapeHtml(item.remoteTaskId || item.clientOrderId || "-")}</span>` },
    { label: "卡片 / 价格", render: (item) => `${escapeHtml(item.cardBrand || "-")} ${escapeHtml(item.cardLast4 ? `•••• ${item.cardLast4}` : "")}<br/><span class="hint">${escapeHtml(item.pricingCurrency || "-")} ${escapeHtml(item.pricingTotal || "-")}</span>` },
    { label: "错误 / 更新", render: (item) => `<code>${escapeHtml(item.lastErrorCode || "-")}</code><br/><span class="hint">${escapeHtml(item.lastErrorMessage || "-")}<br/>${escapeHtml(item.updatedAt || "-")}</span>` },
    { label: "操作", render: (item) => [
      ["waiting_gate", "waiting_mapping", "waiting_capacity", "preparing_card"].includes(item.status) ? `<button class="primary-btn small" type="button" onclick='retryAutomationExecution(${JSON.stringify(item.id)})'>立即重试</button>` : "",
      ["waiting_gate", "waiting_mapping"].includes(item.status) ? `<button class="ghost-btn small" type="button" onclick='takeOverAutomationExecution(${JSON.stringify(item.id)})'>人工处理</button>` : "",
      ["queued", "running", "submit_unknown"].includes(item.status) ? `<button class="ghost-btn small" type="button" onclick='queryAutomationExecution(${JSON.stringify(item.id)})'>立即查询</button>` : "",
      ["manual_review", "manual_hold"].includes(item.status) ? `<button class="primary-btn small" type="button" onclick='resolveAutomationExecution(${JSON.stringify(item.id)}, "succeeded")'>裁决成功</button> <button class="ghost-btn small" type="button" onclick='resolveAutomationExecution(${JSON.stringify(item.id)}, "failed")'>裁决失败</button>` : ""
    ].filter(Boolean).join(" ") || "-" }
  ], executionPayload.items || [], "暂无协议自动化订单");
}

window.loadAutomationProvider = loadAutomationProvider;
window.syncAutomationProvider = syncAutomationProvider;
window.resetAutomationProviderCircuit = resetAutomationProviderCircuit;
window.loadAutomationMapping = loadAutomationMapping;
window.toggleAutomationMapping = toggleAutomationMapping;
window.retryAutomationExecution = retryAutomationExecution;
window.takeOverAutomationExecution = takeOverAutomationExecution;
window.queryAutomationExecution = queryAutomationExecution;
window.resolveAutomationExecution = resolveAutomationExecution;

async function refreshMembershipFulfillmentConsole() {
  await refreshAutomationConsole();
  const payload = await api("/api/admin/membership-fulfillment/settings");
  const settings = payload.settings || {};
  const dependencies = settings.dependencies || {};
  const processor = settings.processor || {};
  const cardPlatforms = payload.cardPlatforms || [];
  const selectedPlatformKey = refs.membershipInventoryPlatform?.value || "spacexcard";
  const efunCard = cardPlatforms.find((item) => item.key === "efuncard") || {};
  refs.membershipOpenApiBase.value = dependencies.openApiBaseUrl || "";
  refs.membershipAppId.value = settings.appId || "";
  refs.membershipAppSecret.value = "";
  refs.membershipAppSecret.placeholder = settings.hasAppSecret
    ? "app_secret 已加密保存；留空保持不变"
    : "sk_...；首次配置必填";
  refs.membershipClearAppSecret.checked = false;
  refs.membershipWebhookSecret.value = "";
  refs.membershipWebhookSecret.placeholder = settings.hasWebhookSecret
    ? "Webhook 密钥已加密保存；留空保持不变"
    : "whsec_...；配置回调后填写";
  refs.membershipClearWebhookSecret.checked = false;
	refs.membershipGptToken.value = "";
	refs.membershipGptToken.placeholder = dependencies.hasGptToken
	  ? "GPT Token 已加密保存；留空保持不变"
	  : "首次配置必填";
	refs.membershipClearGptToken.checked = false;
  refs.membershipEfunCardBaseUrl.value = efunCard.baseUrl || "";
  refs.membershipEfunCardApiKey.value = "";
  refs.membershipEfunCardApiKey.placeholder = efunCard.hasCredential
    ? "API Key 已加密保存；留空保持不变"
    : "首次启用前必填";
  refs.membershipEfunCardClearApiKey.checked = false;
  refs.membershipEfunCardPriority.value = Number(efunCard.priority) || 200;
  refs.membershipEfunCardEnabled.checked = efunCard.enabled === true;
  refs.membershipInventoryPlatform.innerHTML = cardPlatforms.map((item) => `
    <option value="${escapeHtml(item.key)}">${escapeHtml(item.displayName || item.key)}</option>
  `).join("");
  refs.membershipInventoryPlatform.value = cardPlatforms.some((item) => item.key === selectedPlatformKey)
    ? selectedPlatformKey
    : (cardPlatforms[0]?.key || "spacexcard");
  refs.membershipStateProviderUrl.value = dependencies.membershipStateProviderUrl || "";
  refs.membershipCheckoutBrokerUrl.value = dependencies.checkoutBrokerUrl || "";
  if (refs.membershipRolloutMode) refs.membershipRolloutMode.value = settings.rolloutMode || "disabled";
  refs.membershipFulfillmentStatus.innerHTML = `
    <div class="membership-processor-status">
      <div class="membership-processor-status-title">自动处理器</div>
      <div>运行主体：<code>${escapeHtml(processor.owner || "未接管")}</code></div>
      <div>状态：<strong title="${escapeHtml(`状态码：${processor.status || "stopped"}`)}">${escapeHtml(getMembershipProcessorStatusLabel(processor.status || "stopped"))}</strong></div>
      <div>版本：<code>${escapeHtml(processor.version || "-")}</code></div>
      <div>最近心跳：${escapeHtml(processor.heartbeatAt || "-")}</div>
      <div>租约到期：${escapeHtml(processor.expiresAt || "-")}</div>
      <div>最近 Tick：${escapeHtml(processor.lastTickAt || "-")}</div>
      <div>最近成功：${escapeHtml(processor.lastSuccessAt || "-")}</div>
      <div>最近错误：<code>${escapeHtml(processor.lastErrorCode || "无")}</code></div>
    </div>
    <div>付款 Gate：<strong>${settings.paymentGateLocked ? "锁定（安全默认）" : (settings.enabled ? "已启用" : "已停用")}</strong></div>
    <div>Rollout 模式：<code>${escapeHtml(settings.rolloutMode || "disabled")}</code></div>
    <div>OpenAPI app_secret：<strong>${settings.hasAppSecret ? "已配置" : "未配置"}</strong></div>
    <div>Webhook 密钥：<strong>${settings.hasWebhookSecret ? "已配置" : "未配置"}</strong></div>
	<div>旧版 GPT Broker Token（Go 不使用）：<strong>${dependencies.hasGptToken ? "已配置" : "未配置"}</strong></div>
	<div>结账执行器：<code>${escapeHtml(dependencies.executor || "go-headless")}</code></div>
	<div>浏览器扩展：<strong>${dependencies.requiresExtension === false ? "不需要" : "兼容模式"}</strong></div>
    <div>库存初始化：<strong>${escapeHtml(getMembershipInventoryLabel(settings.inventoryStatus || "not_started"))}</strong></div>
    <div>业务时区：${escapeHtml(settings.businessTimezone || "Asia/Shanghai")}</div>
    <div>更新时间：${escapeHtml(settings.updatedAt || "-")}</div>
  `;
  await Promise.all([
    refreshMembershipFulfillments(),
    refreshMembershipInventoryConsole(settings, cardPlatforms),
    refreshMembershipPriceContracts(),
    refreshMembershipProductPolicies(),
    refreshMembershipNoChargeRuns(),
    refreshMembershipCircuits(),
    refreshMembershipCanaryAuthorizations(),
    refreshMembershipQualifications(),
    refreshMembershipAutomaticScopes(),
    refreshMembershipInterventions()
  ]);
}

async function refreshMembershipFulfillments() {
  const payload = await api("/api/admin/membership-fulfillments?limit=200");
  renderTable(refs.membershipFulfillmentList, [
    {
      label: "订单 / 履约",
      render: (item) => `<strong>${escapeHtml(item.orderNo)}</strong><br/><code>${escapeHtml(item.id)}</code>`
    },
    {
      label: "目标 / 状态",
      render: (item) => `<strong>${escapeHtml(item.targetTier)}</strong><br/>${renderMembershipFulfillmentStatus(item.state)}`
    },
    {
      label: "阶段 / 模式",
      render: (item) => `<code>${escapeHtml(item.currentStage || "-")}</code><br/><span class="hint">${escapeHtml(item.runMode || "-")}</span>`
    },
    {
      label: "版本",
      render: (item) => `状态 ${Number(item.stateRevision) || 0}<br/><span class="hint">恢复 ${Number(item.resumeRevision) || 0} / 租约 ${item.browserLeaseEpoch ?? "-"}</span>`
    },
    {
      label: "阻塞信息",
      render: (item) => `${renderExtensionDeliveryError(item.failureCode)}<br/><span class="hint">重试 ${escapeHtml(item.retryAt || "-")}</span>`
    },
    {
      label: "更新时间",
      render: (item) => `<span class="hint">${escapeHtml(item.updatedAt || "-")}</span>`
    },
    {
      label: "操作",
      render: (item) => {
        const actions = [
          `<button class="ghost-btn small" type="button" onclick='viewMembershipFulfillment(${JSON.stringify(item.id)})'>详情</button>`
        ];
        if (["PLUS_APPROVAL_WAIT", "UPGRADE_APPROVAL_WAIT"].includes(item.state)) {
          actions.push(`<button class="ghost-btn small" type="button" onclick='loadMembershipCanaryPreparation(${JSON.stringify(item.id)})'>载入批准</button>`);
        }
        if (item.state === "FUNDING_READY" && !item.runMode) {
          actions.push(`<button class="ghost-btn small" type="button" onclick='loadMembershipCanaryStart(${JSON.stringify(item.id)})'>准备 Canary</button>`);
        }
        if (item.state === "COMPLETED" && item.runMode === "canary") {
          actions.push(`<button class="ghost-btn small" type="button" onclick='loadMembershipQualification(${JSON.stringify(item.id)})'>资格检查</button>`);
        }
        if (item.state === "PARTIAL_FULFILLMENT_EXPIRED") {
          actions.push(`<button class="ghost-btn small" type="button" onclick='loadMembershipCompensation(${JSON.stringify(item.id)})'>记录补偿</button>`);
        }
        return actions.join(" ");
      }
    }
  ], payload.items || [], "暂无会员履约记录");
  renderMembershipCanaryPreparations(payload.items || []);
  setHint(refs.membershipFulfillmentListResult, `已读取 ${payload.items?.length || 0} 条脱敏履约记录`);
}

function membershipCanaryPreparation(item = {}) {
  const source = item.canaryPreparation || item.pagePreparation || item.paymentStage || {};
  const stage = source.stage || source.stageKey
    || (item.state === "UPGRADE_APPROVAL_WAIT" ? "upgrade" : "plus");
  return {
    fulfillmentId: item.id || source.fulfillmentId || "",
    orderNo: item.orderNo || source.orderNo || "",
    targetTier: item.targetTier || source.targetTier || "",
    state: item.state || source.state || "",
    stage,
    cardId: source.cardId || source.selectedCardId || "",
    fundingBudgetUsd: source.fundingBudgetUsd ?? "",
    priceContractId: source.priceContractId || "",
    adapterVersion: source.adapterVersion || "",
    pageFingerprint: source.pageFingerprint || "",
    preparedAt: source.preparedAt || source.updatedAt || item.updatedAt || "",
    ready: source.ready === true
  };
}

function renderMembershipCanaryPreparations(items = []) {
  const readyItems = items
    .filter((item) => ["PLUS_APPROVAL_WAIT", "UPGRADE_APPROVAL_WAIT"].includes(item.state))
    .map(membershipCanaryPreparation);
  membershipPreparedCanaries = new Map(readyItems.map((item) => [item.fulfillmentId, item]));
  renderTable(refs.membershipCanaryReadyList, [
    { label: "订单 / 履约", render: (item) => `<strong>${escapeHtml(item.orderNo || "-")}</strong><br/><code>${escapeHtml(maskMembershipIdentifier(item.fulfillmentId))}</code>` },
    { label: "目标 / 阶段", render: (item) => `<strong>${escapeHtml(item.targetTier || "-")}</strong><br/><code>${escapeHtml(item.stage)}</code>` },
    { label: "页面准备", render: (item) => item.pageFingerprint
      ? `最终快照已就绪<br/><code>${escapeHtml(maskMembershipIdentifier(item.pageFingerprint))}</code>`
      : `审批等待态<br/><span class="hint">载入后补齐服务端脱敏快照</span>` },
    { label: "版本 / 预算", render: (item) => `<code>${escapeHtml(item.adapterVersion || "-")}</code><br/><span class="hint">契约 ${escapeHtml(maskMembershipIdentifier(item.priceContractId))} / $${item.fundingBudgetUsd === "" ? "-" : Number(item.fundingBudgetUsd).toFixed(2)}</span>` },
    { label: "准备时间", render: (item) => `<span class="hint">${escapeHtml(item.preparedAt || "-")}</span>` },
    { label: "操作", render: (item) => `<button class="ghost-btn small" type="button" onclick='loadMembershipCanaryPreparation(${JSON.stringify(item.fulfillmentId)})'>载入并核对</button>` }
  ], readyItems, "当前没有等待管理员批准的 Canary 页面", { paginate: false });
}

function fillMembershipCanaryForm(preparation = {}) {
  refs.membershipCanaryFulfillment.value = preparation.fulfillmentId || "";
  refs.membershipCanaryStage.value = preparation.stage === "upgrade" ? "upgrade" : "plus";
  refs.membershipCanaryCard.value = preparation.cardId || "";
  refs.membershipCanaryBudget.value = preparation.fundingBudgetUsd ?? "";
  refs.membershipCanaryContract.value = preparation.priceContractId || "";
  refs.membershipCanaryAdapter.value = preparation.adapterVersion || "";
  refs.membershipCanaryFingerprint.value = preparation.pageFingerprint || "";
  refs.membershipCanaryConfirm.checked = false;
  refs.membershipCanarySubmit.disabled = preparation.ready !== true;
  refs.membershipCanaryFulfillment.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function loadMembershipCanaryPreparation(id) {
  let preparation = membershipPreparedCanaries.get(id);
  try {
    const payload = await api(`/api/admin/live-canary-authorizations?fulfillmentId=${encodeURIComponent(id)}`);
    const serverPreparation = payload.canaryPreparation || {};
    preparation = membershipCanaryPreparation({
      ...(preparation || {}),
      id,
      canaryPreparation: serverPreparation
    });
    membershipPreparedCanaries.set(id, preparation);
    setHint(
      refs.membershipCanaryResult,
      serverPreparation.ready === true
        ? "已载入服务端脱敏最终快照，请逐项核对后重新验密批准"
        : `页面快照尚未就绪${serverPreparation.reasonCode ? `（${serverPreparation.reasonCode}）` : ""}`
    );
  } catch (error) {
    setHint(refs.membershipCanaryResult, membershipAdminError(error));
  }
  if (preparation) fillMembershipCanaryForm(preparation);
}

function loadMembershipCanaryStart(id) {
  refs.membershipCanaryStartFulfillment.value = String(id || "");
  refs.membershipCanaryStartConfirm.checked = false;
  refs.membershipCanaryStartFulfillment.scrollIntoView({ behavior: "smooth", block: "center" });
}

function loadMembershipQualification(id) {
  refs.membershipQualificationFulfillment.value = id || "";
  refs.membershipQualificationFulfillment.scrollIntoView({ behavior: "smooth", block: "center" });
}

function loadMembershipCompensation(id) {
  refs.membershipCompensationFulfillment.value = id || "";
  refs.membershipCompensationConfirm.checked = false;
  refs.membershipCompensationFulfillment.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function viewMembershipFulfillment(id) {
  if (!refs.membershipFulfillmentDetail) return;
  refs.membershipFulfillmentDetail.textContent = "正在读取履约详情…";
  try {
    const payload = await api(`/api/admin/membership-fulfillments/${encodeURIComponent(id)}`);
    const item = payload.item || {};
    const projection = payload.customerProjection || {};
	const interactiveLogin = String(item.state || "").startsWith("CHECKOUT_LOGIN_");
    refs.membershipFulfillmentDetail.innerHTML = `
      <div class="grid grid-2">
        <div><strong>订单：</strong>${escapeHtml(item.orderNo || "-")}<br/><span class="hint">履约 ${escapeHtml(item.id || "-")}</span></div>
        <div><strong>目标：</strong>${escapeHtml(item.targetTier || "-")}<br/><span class="hint">客户状态 ${escapeHtml(projection.label || "-")}</span></div>
        <div><strong>状态：</strong>${renderMembershipFulfillmentStatus(item.state)}<br/><span class="hint">阶段 ${escapeHtml(item.currentStage || "-")} / 模式 ${escapeHtml(item.runMode || "-")}</span></div>
		<div><strong>版本：</strong>状态 ${Number(item.stateRevision) || 0} / 恢复 ${Number(item.resumeRevision) || 0}<br/><span class="hint">${interactiveLogin ? "Go 可视浏览器 / 密码不入库" : "Go Session Cookie 自动执行"}</span></div>
        <div><strong>失败原因：</strong>${renderExtensionDeliveryError(item.failureCode)}<br/><span class="hint">重试 ${escapeHtml(item.retryAt || "-")}</span></div>
        <div><strong>时间：</strong>${escapeHtml(item.updatedAt || "-")}<br/><span class="hint">完成 ${escapeHtml(item.completedAt || "-")}</span></div>
      </div>
      <div data-membership-fulfillment-attempts class="table-wrapper mt-24"></div>
    `;
    renderTable(refs.membershipFulfillmentDetail.querySelector("[data-membership-fulfillment-attempts]"), [
      { label: "阶段 / 次数", render: (attempt) => `<strong>${escapeHtml(attempt.stage)}</strong> / ${Number(attempt.attemptNo) || 0}` },
      { label: "版本", render: (attempt) => `<code>${escapeHtml(attempt.adapterVersion || "-")}</code><br/><span class="hint">价格 ${attempt.priceContractVersion ?? "-"} / 恢复 ${Number(attempt.resumeRevision) || 0}</span>` },
      { label: "结果", render: (attempt) => attempt.outcomeCode ? renderExtensionDeliveryError(attempt.outcomeCode) : "进行中" },
      { label: "时间", render: (attempt) => `<span class="hint">${escapeHtml(attempt.startedAt || "-")}<br/>${escapeHtml(attempt.endedAt || "-")}</span>` }
    ], payload.attempts || [], "暂无阶段尝试", { paginate: false });
    refs.membershipFulfillmentDetail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    refs.membershipFulfillmentDetail.textContent = `履约详情加载失败：${error.message}`;
  }
}

async function refreshMembershipInventoryConsole(settings = {}, cardPlatforms = []) {
  const providerKey = refs.membershipInventoryPlatform?.value || "spacexcard";
  const platform = cardPlatforms.find((item) => item.key === providerKey) || {};
  const query = new URLSearchParams({ providerKey }).toString();
  const [runPayload, cardsPayload] = await Promise.all([
    api(`/api/admin/membership-inventory/runs/current?${query}`),
    api(`/api/admin/membership-cards?limit=200&${query}`)
  ]);
  const run = runPayload.run;
  const running = run && ["discovering", "reconciling"].includes(run.status);
  refs.membershipInventoryInitialize.disabled = running || !platform.enabled || !platform.hasCredential;
  refs.membershipInventoryRefresh.disabled = running || platform.inventoryStatus !== "completed";
  refs.membershipInventoryProgress.innerHTML = run ? `
    <div>卡台：<strong>${escapeHtml(platform.displayName || providerKey)}</strong></div>
    <div>任务：<code>${escapeHtml(run.id)}</code> / ${escapeHtml(getMembershipInventoryLabel(run.mode || "full"))}</div>
    <div>状态：<strong>${escapeHtml(getMembershipInventoryLabel(run.status))}</strong></div>
    <div>发现：${Number(run.discoveredCards) || 0} / ${run.totalCards == null ? "?" : Number(run.totalCards)}</div>
    <div>处理：${Number(run.processedCards) || 0}，HOLD：${Number(run.heldCards) || 0}</div>
    <div>最后错误：${escapeHtml(getMembershipInventoryLabel(run.lastErrorCode || platform.lastInventoryError || "-"))}</div>
    <div>更新时间：${escapeHtml(run.updatedAt || "-")}</div>
  ` : `${escapeHtml(platform.displayName || providerKey)} 暂无库存初始化记录。`;

  renderTable(refs.membershipCardList, [
    { label: "卡片", render: (item) => `<code>${escapeHtml(item.display || "-")}</code><br/><span class="hint">${escapeHtml(item.providerKey || providerKey)} / ID ${escapeHtml(item.upstreamCardId)}</span>` },
    { label: "产品", render: (item) => `<code>${escapeHtml(item.productCode || "-")}</code>` },
    { label: "上游状态", render: (item) => renderMembershipInventoryStatus(item.upstreamStatus || "-") },
    { label: "余额", render: (item) => `$${Number(item.availableAmount || 0).toFixed(2)}` },
    { label: "Lane / 容量", render: (item) => `${escapeHtml(item.lane || "未分配")} / ${Number(item.consumedSlots) || 0}<br/><span class="hint">${escapeHtml(getMembershipInventoryLabel(item.capacityState || "-"))}</span>` },
    { label: "对账", render: (item) => `${renderMembershipInventoryStatus(item.reconciliationState || "-")}<br/><span class="hint">${escapeHtml(getMembershipInventoryLabel(item.reconciliationReason || "-"))}</span>` },
    { label: "三档行情", render: (item) => (item.prices || []).map((price) => `
      <div>${escapeHtml(price.tier)}：${price.found ? `$${Number(price.amount).toFixed(2)}` : "无"}<br/><span class="hint">${escapeHtml(price.providerTime || "-")}</span></div>
    `).join("") || "-" },
    { label: "同步时间", render: (item) => `<span class="hint">余额 ${escapeHtml(item.lastBalanceSyncAt || "-")}<br/>交易 ${escapeHtml(item.lastTransactionSyncAt || "-")}</span>` },
    { label: "操作", render: (item) => item.upstreamStatus === "ACTIVE" && !item.lane
        && item.reconciliationState === "HOLD" && item.reconciliationReason === "PENDING_SETTLEMENT"
      ? `<button class="ghost-btn small" type="button" data-confirm-plus-lane="${escapeHtml(item.id)}" onclick='confirmMembershipCardPlusLane(${JSON.stringify(item.id)})'>确认为 Plus</button>`
      : "-" }
  ], cardsPayload.items || [], "暂无已初始化卡片");
  setHint(refs.membershipCardListResult, `已读取 ${cardsPayload.items?.length || 0} 张脱敏卡片`);
}

async function confirmMembershipCardPlusLane(id) {
  if (!window.confirm("仅当这张历史卡明确用于 Plus CDK 时才确认。确认后，已同步的待清算交易会占用 Plus 的 1/5 容量；该操作不会调用 SpaceX Card、删卡或冻结卡。是否继续？")) return;
  try {
    await api(`/api/admin/membership-cards/${encodeURIComponent(id)}/confirm-plus-lane`, {
      method: "POST",
      body: JSON.stringify({ confirmation: "legacy_plus_cdk" })
    });
    setHint(refs.membershipCardListResult, "历史卡已确认为 Plus；已按同步交易重新计算容量，没有执行上游卡片操作");
    await refreshMembershipFulfillmentConsole();
  } catch (error) {
    setHint(refs.membershipCardListResult, error.message);
  }
}

async function refreshMembershipPriceContracts() {
  const payload = await api("/api/admin/checkout-price-contracts");
  renderTable(refs.membershipPriceContractList, [
    { label: "套餐", render: (item) => `<strong>${escapeHtml(item.tier)}</strong><br/><span class="hint">v${Number(item.version) || 0}</span><br/><code>${escapeHtml(item.id)}</code>` },
    { label: "PHP 范围", render: (item) => `${Number(item.minAmount).toFixed(2)} - ${Number(item.maxAmount).toFixed(2)}` },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "创建", render: (item) => `${escapeHtml(item.createdBy || "-")}<br/><span class="hint">${escapeHtml(item.createdAt || "-")}</span>` },
    { label: "操作", render: (item) => item.status === "draft"
      ? `<button class="ghost-btn small" type="button" onclick='activateMembershipPriceContract(${JSON.stringify(item.id)})'>激活</button>`
      : "-" }
  ], payload.items || [], "暂无 PHP 价格契约");
}

async function refreshMembershipProductPolicies() {
  const payload = await api("/api/admin/card-product-policies");
  renderTable(refs.membershipProductPolicyList, [
    { label: "产品", render: (item) => `<code>${escapeHtml(item.productCode)}</code><br/><span class="hint">${escapeHtml(item.providerKey)} / 现有 ${Number(item.existingCardCount) || 0} / READY ${Number(item.readyCardCount) || 0}</span>` },
    { label: "新鲜行情证明", render: (item) => ["plus", "x5", "x20"].map((tier) => `${tier}: ${item.provenTiers?.[tier] ? "✓" : "—"}`).join("<br/>") },
    { label: "策略", render: (item) => `${item.enabled ? "已允许" : "未允许"}<br/><span class="hint">revision ${Number(item.revision) || 0}</span>` },
    { label: "操作", render: (item) => `<button class="ghost-btn small" type="button" ${!item.enabled && !item.canEnable ? "disabled" : ""} onclick='setMembershipProductPolicy(${JSON.stringify(item.providerKey)}, ${JSON.stringify(item.productCode)}, ${item.enabled ? "false" : "true"})'>${item.enabled ? "停用" : "允许"}</button>` }
  ], payload.items || [], "库存中尚未发现卡产品");
  setHint(refs.membershipProductPolicyResult, `已读取 ${payload.items?.length || 0} 个产品策略；该操作不会开卡或充值`);
}

async function refreshMembershipNoChargeRuns() {
  const payload = await api("/api/admin/checkout-validation-runs?limit=100");
  renderTable(refs.membershipNoChargeList, [
    { label: "范围", render: (item) => `<strong>${escapeHtml(item.tier)}</strong><br/><code>${escapeHtml(item.siteId)}</code><br/><code>${escapeHtml(item.productId)}</code>` },
    { label: "版本", render: (item) => `<code>${escapeHtml(item.adapterVersion)}</code><br/><span class="hint">${escapeHtml(item.priceContractId)}</span>` },
    { label: "显示价", render: (item) => `${escapeHtml(item.result?.currency || "-")} ${Number(item.result?.displayedAmount || 0).toFixed(2)}` },
    { label: "结果", render: (item) => `${renderStatus(item.status)}<br/><span class="hint">${escapeHtml((item.result?.failedChecks || []).join(", ") || "全部白名单检查通过")}</span>` },
    { label: "记录", render: (item) => `${escapeHtml(item.createdBy || "-")}<br/><span class="hint">${escapeHtml(item.completedAt || item.startedAt || "-")}</span>` }
  ], payload.items || [], "暂无无扣款验证记录");
}

async function refreshMembershipCircuits() {
  const payload = await api("/api/admin/fulfillment-circuits");
  renderTable(refs.membershipCircuitList, [
    { label: "依赖 / 范围", render: (item) => `<strong>${escapeHtml(item.dependency)}</strong><br/><code>${escapeHtml(item.scopeKey)}</code>` },
    { label: "状态", render: (item) => `${renderStatus(item.state)}<br/><span class="hint">失败 ${Number(item.failureCount) || 0} / 恢复 ${Number(item.recoveryRevision) || 0}</span>` },
    { label: "原因", render: (item) => `${escapeHtml(item.reasonCode || "-")}<br/><span class="hint">重试 ${escapeHtml(item.retryAt || "-")}</span>` },
    { label: "操作", render: (item) => item.state === "open"
      ? `<button class="ghost-btn small" type="button" onclick='requestMembershipCircuitProbe(${JSON.stringify(item.id)})'>请求探测</button>`
      : "-" }
  ], payload.items || [], "当前没有依赖熔断记录");
}

async function refreshMembershipCanaryAuthorizations() {
  const payload = await api("/api/admin/live-canary-authorizations");
  renderTable(refs.membershipCanaryAuthorizationList, [
    { label: "批准 / 履约", render: (item) => `<code>${escapeHtml(maskMembershipIdentifier(item.id))}</code><br/><span class="hint">${escapeHtml(maskMembershipIdentifier(item.fulfillmentId))}</span>` },
    { label: "目标 / 阶段", render: (item) => `<strong>${escapeHtml(item.targetTier || "-")}</strong><br/><code>${escapeHtml(item.stage || item.stageKey || "-")}</code>` },
    { label: "快照绑定", render: (item) => `卡片 <code>${escapeHtml(maskMembershipIdentifier(item.selectedCardId || item.cardId))}</code><br/><span class="hint">预算 $${Number(item.fundingBudgetUsd || 0).toFixed(2)}</span>` },
    { label: "精确版本", render: (item) => `<code>${escapeHtml(item.adapterVersion || "-")}</code><br/><span class="hint">契约 ${escapeHtml(maskMembershipIdentifier(item.priceContractId))} / v${item.priceContractVersion ?? "-"}</span>` },
    { label: "状态", render: (item) => `${renderStatus(item.state || "-")}<br/><span class="hint">到期 ${escapeHtml(item.expiresAt || "-")}</span>` },
    { label: "审批", render: (item) => `${escapeHtml(item.approvedBy || "-")}<br/><span class="hint">${escapeHtml(item.approvedAt || "-")}</span>` }
  ], payload.items || [], "暂无 Canary 批准记录");
}

async function refreshMembershipQualifications() {
  const payload = await api("/api/admin/tier-rollout-qualifications");
  renderTable(refs.membershipQualificationList, [
    { label: "会员类型", render: (item) => `<strong>${escapeHtml(item.tier || "-")}</strong>` },
    { label: "Adapter", render: (item) => `<code>${escapeHtml(item.adapterVersion || "-")}</code><br/><span class="hint">${escapeHtml(item.adapterPath || "-")}</span>` },
    { label: "价格契约", render: (item) => `<code>${escapeHtml(maskMembershipIdentifier(item.priceContractId))}</code><br/><span class="hint">v${item.priceContractVersion ?? "-"}</span>` },
    { label: "证据履约", render: (item) => `<code>${escapeHtml(maskMembershipIdentifier(item.fulfillmentId))}</code><br/><span class="hint">${escapeHtml(item.settlement || "COMPLETE")} / 续费已关闭</span>` },
    { label: "取得时间", render: (item) => `<span class="hint">${escapeHtml(item.qualifiedAt || "-")}</span>` }
  ], payload.items || [], "尚未取得分层上线资格");
}

async function refreshMembershipAutomaticScopes() {
  const payload = await api("/api/admin/automatic-checkout-scopes");
  const items = payload.items || [];
  membershipAutomaticScopes = new Map(items.map((item) => [item.id, item]));
  renderTable(refs.membershipAutomaticScopeList, [
    { label: "范围 / 修订", render: (item) => `<code>${escapeHtml(maskMembershipIdentifier(item.id))}</code><br/><span class="hint">revision ${Number(item.revision) || 0}</span>` },
    { label: "精确业务范围", render: (item) => `<code>${escapeHtml(item.siteId || "-")}</code><br/><code>${escapeHtml(item.productId || "-")}</code><br/><strong>${escapeHtml(item.tier || "-")}</strong>` },
    { label: "版本绑定", render: (item) => `<code>${escapeHtml(item.adapterVersion || "-")}</code><br/><span class="hint">契约 ${escapeHtml(maskMembershipIdentifier(item.priceContractId))} / v${item.priceContractVersion ?? "-"}</span>` },
    { label: "每日上限", render: (item) => `${Number(item.dailyOrderLimit) || 0} 单<br/><span class="hint">风险 $${Number(item.dailyRiskLimitUsd || 0).toFixed(2)}</span>` },
    { label: "状态", render: (item) => `${renderStatus(item.status || "-")}<br/><span class="hint">启用 ${escapeHtml(item.activatedAt || "-")}</span>` },
    {
      label: "操作",
      render: (item) => [
        `<button class="ghost-btn small" type="button" onclick='loadMembershipAutomaticScopeRevision(${JSON.stringify(item.id)})'>载入修订</button>`,
        item.status !== "disabled"
          ? `<button class="ghost-btn small" type="button" onclick='disableMembershipAutomaticScope(${JSON.stringify(item.id)})'>停用范围</button>`
          : ""
      ].filter(Boolean).join(" ")
    }
  ], items, "尚未创建 Automatic Checkout 范围");
}

function loadMembershipAutomaticScopeRevision(id) {
  const item = membershipAutomaticScopes.get(id);
  if (!item) return setHint(refs.membershipAutomaticScopeResult, "请先刷新范围列表");
  refs.membershipAutomaticRevisionId.value = item.id || "";
  refs.membershipAutomaticRevisionOrderLimit.value = Number(item.dailyOrderLimit) || 1;
  refs.membershipAutomaticRevisionOrderLimit.min = String(Number(item.dailyOrderLimit) || 1);
  refs.membershipAutomaticRevisionRiskLimit.value = Number(item.dailyRiskLimitUsd) || "";
  refs.membershipAutomaticRevisionRiskLimit.min = String(Number(item.dailyRiskLimitUsd) || 0.01);
  refs.membershipAutomaticRevisionAdapter.value = "";
  refs.membershipAutomaticRevisionContract.value = "";
  refs.membershipAutomaticRevisionConfirm.checked = false;
  refs.membershipAutomaticRevisionId.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function disableMembershipAutomaticScope(id) {
  if (!window.confirm("确认停用该精确自动范围？尚未跨资金边界的新动作将停止；已跨边界的履约只继续安全对账和续费保护。")) return;
  try {
    await api(`/api/admin/automatic-checkout-scopes/${encodeURIComponent(id)}/disable`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.membershipAutomaticScopeResult, "自动范围已停用；没有执行资金或卡片动作");
    await refreshMembershipAutomaticScopes();
  } catch (error) {
    setHint(refs.membershipAutomaticScopeResult, membershipAdminError(error));
  }
}

async function refreshMembershipInterventions() {
  const payload = await api("/api/admin/fulfillment-interventions?limit=200");
  renderTable(refs.membershipInterventionList, [
    { label: "履约 / 提醒", render: (item) => `<code>${escapeHtml(maskMembershipIdentifier(item.fulfillmentId))}</code><br/><span class="hint">${escapeHtml(maskMembershipIdentifier(item.id))}</span>` },
    { label: "状态版本", render: (item) => `${renderMembershipFulfillmentStatus(item.state)}<br/><span class="hint">revision ${Number(item.stateRevision) || 0}</span>` },
    { label: "原因", render: (item) => `<code>${escapeHtml(item.reasonCode || "-")}</code>` },
    { label: "通知", render: (item) => `${escapeHtml(item.feishuStatus || "-")}<br/><span class="hint">${escapeHtml(item.feishuSentAt || item.createdAt || "-")}</span>` },
    { label: "确认", render: (item) => item.acknowledgedAt
      ? `${escapeHtml(item.acknowledgedBy || "-")}<br/><span class="hint">${escapeHtml(item.acknowledgedAt)}</span>`
      : `<button class="ghost-btn small" type="button" onclick='acknowledgeMembershipIntervention(${JSON.stringify(item.id)})'>确认收到</button>` }
  ], payload.items || [], "当前没有履约人工介入提醒");
}

async function acknowledgeMembershipIntervention(id) {
  try {
    await api(`/api/admin/fulfillment-interventions/${encodeURIComponent(id)}/ack`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.membershipInterventionResult, "已记录确认收到；履约工作流状态未改变");
    await refreshMembershipInterventions();
  } catch (error) {
    setHint(refs.membershipInterventionResult, membershipAdminError(error));
  }
}

async function activateMembershipPriceContract(id) {
  if (!window.confirm("确认激活该 PHP 价格契约？同套餐旧契约会退役，未来自动范围会保持暂停。")) return;
  try {
    await api(`/api/admin/checkout-price-contracts/${encodeURIComponent(id)}/activate`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.membershipPriceContractResult, "价格契约已激活");
    await refreshMembershipPriceContracts();
  } catch (error) {
    setHint(refs.membershipPriceContractResult, error.message);
  }
}

async function setMembershipProductPolicy(providerKey, productCode, enabled) {
  try {
    await api("/api/admin/card-product-policies", {
      method: "PUT",
      body: JSON.stringify({ items: [{ providerKey, productCode, enabled }] })
    });
    setHint(refs.membershipProductPolicyResult, enabled ? "产品已加入允许列表；仍不会自动开卡" : "产品已从允许列表停用");
    await refreshMembershipProductPolicies();
  } catch (error) {
    setHint(refs.membershipProductPolicyResult, error.message);
  }
}

async function requestMembershipCircuitProbe(id) {
  try {
    await api(`/api/admin/fulfillment-circuits/${encodeURIComponent(id)}/probe`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.membershipCircuitResult, "只读半开探测已排队，等待 Worker 执行");
    await refreshMembershipCircuits();
  } catch (error) {
    setHint(refs.membershipCircuitResult, error.message);
  }
}

window.activateMembershipPriceContract = activateMembershipPriceContract;
window.confirmMembershipCardPlusLane = confirmMembershipCardPlusLane;
window.setMembershipProductPolicy = setMembershipProductPolicy;
window.requestMembershipCircuitProbe = requestMembershipCircuitProbe;
window.viewMembershipFulfillment = viewMembershipFulfillment;
window.loadMembershipCanaryPreparation = loadMembershipCanaryPreparation;
window.loadMembershipCanaryStart = loadMembershipCanaryStart;
window.loadMembershipQualification = loadMembershipQualification;
window.loadMembershipCompensation = loadMembershipCompensation;
window.loadMembershipAutomaticScopeRevision = loadMembershipAutomaticScopeRevision;
window.disableMembershipAutomaticScope = disableMembershipAutomaticScope;
window.acknowledgeMembershipIntervention = acknowledgeMembershipIntervention;

async function runExtensionTokenAction(action) {
  const labels = { generate: "生成", reset: "重置", revoke: "撤销" };
  if (action !== "generate" && !window.confirm(`确认${labels[action]} Extension Token？当前扩展连接会立即失效。`)) return;
  const payload = await api("/api/admin/extension-delivery/token", {
    method: "POST",
    body: JSON.stringify({ action })
  });
  refs.extensionDeliveryIssuedToken.value = payload.token || "";
  setHint(
    refs.extensionDeliverySettingsResult,
    payload.token ? "Token 只显示这一次，请立即复制到扩展设置页。" : "Extension Token 已撤销，自动交付同时停用。"
  );
  await refreshExtensionDeliverySettings();
}

async function retryExtensionDelivery(orderNo) {
  try {
    const payload = await api(`/api/admin/extension-deliveries/${encodeURIComponent(orderNo)}/retry`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.extensionDeliveryListResult, `已请求重试 ${orderNo}，revision=${payload.retryRevision}`);
    await refreshExtensionDeliveries();
  } catch (error) {
    setHint(refs.extensionDeliveryListResult, error.message);
  }
}

window.retryExtensionDelivery = retryExtensionDelivery;

function renderSmsProviderInfo(item) {
  const source = escapeHtml(item.inventorySource || "-");
  if (!item.smsProvider) return source;
  if (item.smsProvider === "383api") {
    return `${source}<br/><code>383api project:${escapeHtml(item.smsAppId || "-")} prefix:${escapeHtml(item.smsPrefixFilter || "-")}</code>`;
  }
  return `${source}<br/><code>${escapeHtml(item.smsProvider)} app:${escapeHtml(item.smsAppId || "-")} type:${escapeHtml(item.smsCardType || "-")} expiry:${escapeHtml(item.smsExpiry ?? "-")}</code>`;
}

async function refreshSmsSites() {
  const payload = await api("/api/admin/sms/sites");
  const items = payload.items || [];
  if (refs.smsCardSite) {
    refs.smsCardSite.innerHTML = items.length
      ? items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} (${escapeHtml(item.slug)})</option>`).join("")
      : `<option value="">暂无站点</option>`;
  }
  renderTable(refs.smsSiteList, [
    { label: "站点", render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><code>${escapeHtml(item.slug)}</code>` },
    { label: "资源来源", render: (item) => renderSmsProviderInfo(item) },
    { label: "卡密数", render: (item) => item.cardCount },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "备注", render: (item) => escapeHtml(item.note || "-") },
    { label: "操作", render: (item) => `<button class="ghost-btn small" type="button" onclick="configSmsProviderSite('${escapeHtml(item.id)}','${escapeHtml(item.smsProvider || item.inventorySource || "")}')">配置</button>` }
  ], items, "暂无接码站点");
}

async function configSmsProviderSite(id, provider) {
  if (provider === "383api") {
    await config383ApiSite(id);
    return;
  }
  await configNexSmsSite(id);
}

async function configNexSmsSite(id) {
  const apiKey = window.prompt("NexSMS API Key（留空则保留原密钥）：") || "";
  const appId = window.prompt("NexSMS appId：");
  if (!appId) return;
  const cardType = Number(window.prompt("type（1首卡/2重启/3续费）：", "1") || 1);
  const expiry = Number(window.prompt("expiry（0随机，1-6按文档）：", "0") || 0);
  try {
    await api(`/api/admin/sms/sites/${encodeURIComponent(id)}/nexsms`, {
      method: "PATCH",
      body: JSON.stringify({ apiKey: apiKey.trim(), appId: appId.trim(), cardType, expiry })
    });
    setHint(refs.smsSiteResult, "NexSMS 配置已保存");
    await refreshSmsConsole();
  } catch (error) {
    setHint(refs.smsSiteResult, error.message);
  }
}

async function config383ApiSite(id) {
  const apiKey = window.prompt("383api API Key（留空则保留原密钥）：") || "";
  const projectId = window.prompt("383api project_id：");
  if (!projectId) return;
  const prefix = window.prompt("号段筛选 prefix（可留空）：", "") || "";
  try {
    await api(`/api/admin/sms/sites/${encodeURIComponent(id)}/383api`, {
      method: "PATCH",
      body: JSON.stringify({ apiKey: apiKey.trim(), projectId: projectId.trim(), prefix: prefix.trim() })
    });
    setHint(refs.smsSiteResult, "383api 配置已保存");
    await refreshSmsConsole();
  } catch (error) {
    setHint(refs.smsSiteResult, error.message);
  }
}

window.configSmsProviderSite = configSmsProviderSite;
window.configNexSmsSite = configNexSmsSite;
window.config383ApiSite = config383ApiSite;
async function refreshSmsCards() {
  const payload = await api("/api/admin/sms/cards");
  renderTable(refs.smsCardList, [
    { label: "", render: (item) => `<input type="checkbox" class="sms-card-check" value="${item.id}" />` },
    { label: "卡密", render: (item) => `<code>${escapeHtml(item.cardKey)}</code>` },
    { label: "站点", render: (item) => escapeHtml(item.siteName) },
    { label: "前缀", render: (item) => `<code>${escapeHtml(item.prefix)}</code>` },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "当前订单", render: (item) => item.currentOrderId ? `<code>${escapeHtml(item.currentOrderId)}</code>` : "-" },
    { label: "创建时间", render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt)}</span>` }
  ], payload.items || [], "暂无接码卡密");
}

async function refreshSmsOrders() {
  const payload = await api("/api/admin/sms/orders");
  renderTable(refs.smsOrderList, [
    { label: "订单号", render: (item) => `<code>${escapeHtml(item.orderNo)}</code>` },
    { label: "卡密", render: (item) => `<code>${escapeHtml(item.cardKey)}</code>` },
    { label: "站点", render: (item) => escapeHtml(item.siteName) },
    { label: "手机号", render: (item) => escapeHtml(item.phone || "-") },
    { label: "验证码", render: (item) => escapeHtml(item.verificationCode || "-") },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "退款时间", render: (item) => escapeHtml(item.refundedAt || "-") }
  ], payload.items || [], "暂无接码订单");
}

async function refreshSmsEntries() {
  const state = getTableState(refs.smsList);
  const params = new URLSearchParams({
    page: String(state.page || 1),
    pageSize: String(state.pageSize || DEFAULT_TABLE_PAGE_SIZE)
  });
  const payload = await api(`/api/admin/sms/entries?${params.toString()}`);
  renderTable(refs.smsList, [
    { label: "", render: (item) => `<input type="checkbox" class="sms-check" value="${item.id}" data-public-key="${escapeHtml(item.publicKey)}" data-phone="${escapeHtml(item.phone)}" data-sms-url="${escapeHtml(item.smsUrl)}" />` },
    { label: "库存卡密", render: (item) => `<code>${escapeHtml(item.publicKey)}</code>` },
    { label: "手机号", render: (item) => escapeHtml(item.phone) },
    { label: "接码网址", render: (item) => `<a href="${escapeHtml(item.smsUrl)}" target="_blank" style="word-break:break-all">${escapeHtml(item.smsUrl)}</a>` },
    { label: "前缀", render: (item) => `<code>${escapeHtml(item.prefix)}</code>` },
    { label: "批次名称", render: (item) => escapeHtml(item.batchName || "-") },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "创建时间", render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt)}</span>` }
  ], payload.items || [], "暂无静态库存记录", {
    server: true,
    total: Number(payload.total ?? payload.items?.length ?? 0),
    page: Number(payload.page ?? state.page),
    pageSize: Number(payload.pageSize ?? state.pageSize),
    onPageChange: () => refreshSmsEntries().catch((error) => {
      refs.smsList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
    })
  });
}

async function refreshSmsConsole() {
  await Promise.all([
    refreshSmsSites(),
    refreshSmsCards(),
    refreshSmsOrders(),
    refreshSmsEntries()
  ]);
}

async function refreshOrders() {
  const payload = await api("/api/admin/orders");
  renderTable(refs.orderList, [
    { label: "订单号", render: (item) => `<code>${item.order_no}</code>` },
    { label: "卡密", render: (item) => `<code>${item.public_key}</code>` },
    { label: "网站", render: (item) => item.site_name || "-" },
    { label: "处理方式", render: (item) => item.processing_mode === "manual"
      ? `<span class="table-badge status-processing">人工 ${escapeHtml(item.manual_type || "")}</span>`
      : `<span class="table-badge status-active">自动</span>` },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "错误", render: (item) => `<span title="${escapeHtml(item.error_message || "")}">${item.error_message ? (item.error_message.slice(0, 20) + "...") : "-"}</span>` },
    { label: "手动更新", render: (item) => `
      <div style="display:grid;gap:6px;min-width:180px">
        <select class="manual-order-status" data-order-no="${escapeHtml(item.order_no)}">
          ${["pending", "processing", "succeeded", "failed"].map((status) => `<option value="${status}" ${item.status === status ? "selected" : ""}>${renderStatusText(status)}</option>`).join("")}
        </select>
        <input class="manual-order-error" data-order-no="${escapeHtml(item.order_no)}" placeholder="失败原因（可选）" value="${escapeHtml(item.error_message || "")}" />
        <button class="ghost-btn small" type="button" onclick='updateOrderStatus(${JSON.stringify(item.order_no)})'>更新状态</button>
      </div>
    ` }
  ], payload.items);
}

async function updateOrderStatus(orderNo) {
  const statusEl = Array.from(refs.orderList.querySelectorAll(".manual-order-status"))
    .find((item) => item.dataset.orderNo === orderNo);
  const errorEl = Array.from(refs.orderList.querySelectorAll(".manual-order-error"))
    .find((item) => item.dataset.orderNo === orderNo);
  if (!statusEl) return;
  await api(`/api/admin/orders/${encodeURIComponent(orderNo)}/status`, {
    method: "PATCH",
    body: JSON.stringify({
      status: statusEl.value,
      errorMessage: errorEl?.value?.trim() || ""
    })
  });
  await Promise.all([refreshOrders(), refreshCdkeys(), refreshDashboard()]);
}

window.updateOrderStatus = updateOrderStatus;

async function refreshJobs() {
  const payload = await api("/api/admin/jobs");
  renderTable(refs.jobList, [
    { label: "", render: (item) => `<input type="checkbox" class="job-check" value="${item.id}" />` },
    { label: "订单号", render: (item) => `<code>${item.order_no}</code>` },
    { label: "网站", render: (item) => item.site_name || "-" },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "尝试", render: (item) => `${item.attempt_count}/${item.max_attempts}` },
    { label: "最后错误", render: (item) => `<span style="font-size:12px;color:var(--error)" title="${escapeHtml(item.last_error || "")}">${item.last_error ? (item.last_error.slice(0, 30) + "...") : "-"}</span>` }
  ], payload.items);
}

async function refreshLogs() {
  const payload = await api("/api/admin/logs");
  renderTable(refs.logList, [
    { label: "时间", render: (item) => item.created_at },
    { label: "动作", render: (item) => `<code>${item.action}</code>` },
    { label: "资源", render: (item) => `${item.resource_type}${item.resource_id ? ` / ${item.resource_id}` : ""}` },
    { label: "执行人", render: (item) => item.actor },
    { label: "详情", render: (item) => item.detail ? `<pre style="font-size:11px">${JSON.stringify(item.detail, null, 2)}</pre>` : "-" }
  ], payload.items);
}

function shortCommit(value) {
  return value ? String(value).slice(0, 8) : "-";
}

function renderSystemInfo(payload) {
  const state = payload.updateState || {};
  const membership = payload.membership || state.membership || {};
  const isBusy = ["running", "checking"].includes(state.status);
  const localChanges = payload.localChanges || state.localChanges || [];
  const hasLocalChanges = payload.hasLocalChanges || state.hasLocalChanges || localChanges.length > 0;
  const gitEnvironment = payload.isGitRepo === false ? "异常" : payload.upstream === "" ? "缺 upstream" : "正常";
  if (refs.sidebarVersion) refs.sidebarVersion.textContent = `v0.1.0 · ${shortCommit(payload.localCommit || state.localCommit)}`;
  const cards = [
    ["Git 环境", gitEnvironment],
    ["分支", payload.branch || state.branch || "-"],
    ["本地版本", shortCommit(payload.localCommit || state.localCommit)],
    ["远端版本", shortCommit(payload.remoteCommit || state.remoteCommit)],
    ["更新状态", state.status || "idle"],
    ["是否有更新", payload.hasUpdate || state.hasUpdate ? "有更新" : "无"],
    ["会员 Module", membership.sourcePresent
      ? (membership.firstInstallRequired ? "待首次安装" : (membership.versionMatches ? "已纳管" : "版本不一致"))
      : "缺失"],
    ["会员源码版本", shortCommit(membership.sourceVersion)],
    ["会员运行版本", shortCommit(membership.installedVersion)],
    ["Go Worker", membership.workerService === "active" && membership.heartbeatFresh ? "运行中" : (membership.workerService || "未安装")],
    ["Python Executor", membership.pythonExecutorService || "未安装"]
  ];

  refs.systemVersionCards.innerHTML = cards.map(([label, value]) => `
    <article class="stat">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `).join("");

  setHint(refs.systemUpdateHint, state.error
    ? `异常: ${state.error}`
    : hasLocalChanges
      ? `检测到本地改动，更新会暂存。`
    : `最后状态: ${state.status || "idle"}`);
    
  refs.systemUpdateLog.textContent = payload.log || "暂无日志";
  refs.checkEnvironmentBtn.disabled = isBusy;
  refs.checkUpdateBtn.disabled = isBusy;
  refs.startUpdateBtn.disabled = isBusy || gitEnvironment !== "正常";

  if (isBusy && !updatePollTimer) startUpdatePolling();
}

async function refreshSystemVersion() {
  const payload = await api("/api/admin/system/version");
  renderSystemInfo(payload);
}

async function checkSystemEnvironment() {
  setHint(refs.systemUpdateHint, "正在检测环境...");
  const payload = await api("/api/admin/system/check-environment", {
    method: "POST",
    body: JSON.stringify({})
  });
  renderSystemInfo(payload);
}

async function refreshSystemUpdateStatus() {
  const payload = await api("/api/admin/system/update-status");
  renderSystemInfo({
    updateState: payload.updateState,
    membership: payload.membership,
    log: payload.log,
    nodeEnv: ""
  });

  if (!["running", "checking"].includes(payload.updateState?.status)) {
    stopUpdatePolling();
    await refreshSystemVersion();
  }
}

function getDownloadFilename(response, fallback) {
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

async function downloadMigrationBackup() {
  const token = getToken();
  setButtonBusy(refs.migrationBackupBtn, true, "生成中...");
  setHint(refs.migrationBackupResult, "正在生成敏感迁移包，请稍候...");
  try {
    const response = await fetch(`${API_BASE}/api/admin/migration/backup`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || "生成备份失败");
    }
    const blob = await response.blob();
    const filename = getDownloadFilename(response, `kawang-migration-${Date.now()}-sensitive.tar.gz`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setHint(refs.migrationBackupResult, `已生成并下载：${filename}`);
  } catch (error) {
    setHint(refs.migrationBackupResult, error.message);
  } finally {
    setButtonBusy(refs.migrationBackupBtn, false);
  }
}

function renderMigrationSummary(payload) {
  const manifest = payload.manifest || {};
  const rows = [
    ["类型", manifest.type || "-"],
    ["生成时间", manifest.createdAt || "-"],
    ["包含 .env", manifest.includesEnv ? "是" : "否"],
    ["数据库大小", manifest.database?.size ? `${manifest.database.size} bytes` : "-"],
    ["文件", (payload.files || []).join(", ")]
  ];
  refs.migrationRestoreSummary.innerHTML = `
    <table>
      <tbody>${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</tbody>
    </table>
  `;
}

async function validateMigrationPackage() {
  const file = refs.migrationRestoreFile?.files?.[0];
  if (!file) {
    setHint(refs.migrationRestoreResult, "请先选择迁移包");
    return;
  }
  migrationRestoreUploadId = null;
  refs.migrationRestoreBtn.disabled = true;
  setButtonBusy(refs.migrationValidateBtn, true, "校验中...");
  setHint(refs.migrationRestoreResult, "正在上传并校验迁移包...");
  try {
    const payload = await api("/api/admin/migration/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": file.name
      },
      body: file
    });
    migrationRestoreUploadId = payload.uploadId;
    renderMigrationSummary(payload);
    refs.migrationRestoreBtn.disabled = refs.migrationConfirmInput.value.trim() !== "确认恢复";
    setHint(refs.migrationRestoreResult, "校验通过。确认无误后输入“确认恢复”执行恢复。");
  } catch (error) {
    refs.migrationRestoreSummary.innerHTML = "";
    setHint(refs.migrationRestoreResult, error.message);
  } finally {
    setButtonBusy(refs.migrationValidateBtn, false);
  }
}

async function restoreMigrationPackage() {
  if (!migrationRestoreUploadId) {
    setHint(refs.migrationRestoreResult, "请先校验迁移包");
    return;
  }
  const confirmation = refs.migrationConfirmInput.value.trim();
  if (confirmation !== "确认恢复") {
    setHint(refs.migrationRestoreResult, "请输入“确认恢复”后再执行");
    return;
  }
  if (!window.confirm("确认恢复迁移包？该操作会覆盖当前 .env 和数据库文件。")) return;
  setButtonBusy(refs.migrationRestoreBtn, true, "恢复中...");
  setHint(refs.migrationRestoreResult, "正在恢复，请不要关闭页面...");
  try {
    const payload = await api("/api/admin/migration/restore", {
      method: "POST",
      body: JSON.stringify({ uploadId: migrationRestoreUploadId, confirmation })
    });
    migrationRestoreUploadId = null;
    refs.migrationRestoreBtn.disabled = true;
    const commands = (payload.restartCommands || []).join("\n");
    refs.migrationRestoreResult.innerHTML = `
      <div>恢复完成，维护模式已开启。恢复前备份：<code>${escapeHtml(payload.preRestoreBackupDir || "-")}</code></div>
      <pre class="log-viewer mt-12">${escapeHtml(commands)}</pre>
    `;
  } catch (error) {
    setHint(refs.migrationRestoreResult, error.message);
  } finally {
    setButtonBusy(refs.migrationRestoreBtn, false);
    if (!migrationRestoreUploadId) refs.migrationRestoreBtn.disabled = true;
  }
}

const stabilityLabels = { stable: "稳定", bumpy: "颠簸", danger: "危险" };

function renderStability(value) {
  const label = stabilityLabels[value] || value;
  return `<span class="table-badge stability-${value}">${label}</span>`;
}

async function refreshSubscriptionCardTypes() {
  const payload = await api("/api/admin/subscriptions/card-types");
  renderTable(refs.subCardTypeList, [
    { label: "名称", render: (item) => `<strong>${escapeHtml(item.name)}</strong>` },
    { label: "总订阅量", render: (item) => item.totalSubscriptions },
    { label: "总掉订阅", render: (item) => item.totalDrops },
    { label: "今日掉订阅", render: (item) => item.todayDrops },
    { label: "稳定性", render: (item) => renderStability(item.stability) },
    { label: "可见", render: (item) => item.visible ? renderStatus("active") : renderStatus("disabled") },
    { label: "操作", render: (item) => `
      <button class="primary-btn small" type="button" onclick="editSubCardType('${escapeHtml(item.id)}', '${escapeHtml(item.name)}', ${item.totalSubscriptions})">编辑</button>
      <button class="ghost-btn small" style="padding:6px 12px;font-size:13px" type="button" onclick="toggleSubCardTypeVisibility('${escapeHtml(item.id)}')">${item.visible ? "隐藏" : "显示"}</button>
    ` }
  ], payload.items, "暂无卡种数据");
}

async function refreshSubscriptionRequests() {
  const payload = await api("/api/admin/subscriptions/requests");
  renderTable(refs.subRequestList, [
    { label: "订单号/QQ", render: (item) => `<code>${escapeHtml(item.identifier)}</code>` },
    { label: "卡种", render: (item) => escapeHtml(item.card_type_name || "-") },
    { label: "类型", render: (item) => escapeHtml(item.drop_type) },
    { label: "状态", render: (item) => renderStatus(item.status) },
    { label: "提交时间", render: (item) => `<span style="font-size:12px">${item.created_at}</span>` },
    { label: "操作", render: (item) => item.status === "pending" ? `
      <button class="primary-btn small" type="button" onclick="reviewSubRequest('${escapeHtml(item.id)}', 'approve')">批准</button>
      <button class="ghost-btn small" style="padding:6px 12px;font-size:13px" type="button" onclick="reviewSubRequest('${escapeHtml(item.id)}', 'reject')">否决</button>
    ` : `<span style="font-size:12px;color:var(--muted)">${item.reviewed_by ? `${item.reviewed_by}` : "-"}</span>` }
  ], payload.items, "暂无订阅申请");
}

async function refreshSubscriptions() {
  await Promise.all([
    refreshSubscriptionCardTypes(),
    refreshSubscriptionRequests()
  ]);
}

async function editSubCardType(id, name, totalSubscriptions) {
  refs.subCtEditId.value = id;
  refs.subCtName.value = name;
  refs.subCtTotal.value = totalSubscriptions;
  refs.subCtSubmitBtn.textContent = "保存修改";
  refs.subCtCancelBtn.classList.remove("hidden");
  refs.subCtName.focus();
}

async function toggleSubCardTypeVisibility(id) {
  try {
    await api(`/api/admin/subscriptions/card-types/${id}/visibility`, { method: "PATCH" });
    await refreshSubscriptions();
  } catch (error) {
    setHint(refs.subCtResult, error.message);
  }
}

async function reviewSubRequest(id, action) {
  const label = action === "approve" ? "批准" : "否决";
  if (!window.confirm(`确认${label}该订阅申请？`)) return;
  try {
    await api(`/api/admin/subscriptions/requests/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
    await refreshSubscriptions();
  } catch (error) {
    alert(error.message);
  }
}

window.editSubCardType = editSubCardType;
window.toggleSubCardTypeVisibility = toggleSubCardTypeVisibility;
window.reviewSubRequest = reviewSubRequest;

// ── Notification Monitors ──

const NOTIFY_INTERVAL_OPTIONS = [
  { value: 1, label: "1 秒" },
  { value: 2, label: "2 秒" },
  { value: 5, label: "5 秒" },
  { value: 10, label: "10 秒" },
  { value: 15, label: "15 秒" },
  { value: 30, label: "30 秒" },
  { value: 60, label: "1 分钟" },
  { value: 120, label: "2 分钟" },
  { value: 300, label: "5 分钟" },
  { value: 600, label: "10 分钟" },
  { value: 900, label: "15 分钟" },
  { value: 1800, label: "30 分钟" },
  { value: 3600, label: "1 小时" }
];

const NOTIFY_OPERATORS = [
  { value: "equals", label: "等于 (equals)" },
  { value: "not_equals", label: "不等于 (not_equals)" },
  { value: "contains", label: "包含 (contains)" },
  { value: "not_contains", label: "不包含 (not_contains)" },
  { value: "gt", label: "大于 (>)" },
  { value: "gte", label: "大于等于 (>=)" },
  { value: "lt", label: "小于 (<)" },
  { value: "lte", label: "小于等于 (<=)" },
  { value: "exists", label: "字段存在" },
  { value: "not_exists", label: "字段不存在" }
];

const NOTIFY_OPERATORS_NO_VALUE = new Set(["exists", "not_exists"]);
const NOTIFY_EVENT_LABELS = {
  matched: "命中",
  not_matched: "未命中",
  fetch_error: "请求异常",
  send_error: "通知失败",
  send_ok: "通知成功",
  test: "测试执行"
};

let notifyMonitorsCache = [];

function syncNotifyModeUi() {
  const isBrowser = refs.notifyMonitorType?.value === "browser";
  refs.notifyBrowserFields?.classList.toggle("hidden", !isBrowser);
}

function populateNotifyIntervalOptions() {
  if (!refs.notifyInterval || refs.notifyInterval.dataset.populated === "1") return;
  refs.notifyInterval.innerHTML = NOTIFY_INTERVAL_OPTIONS
    .map((option) => `<option value="${option.value}">${option.label}</option>`)
    .join("");
  refs.notifyInterval.value = "60";
  refs.notifyInterval.dataset.populated = "1";
}

function setNotifyIntervalValue(seconds) {
  populateNotifyIntervalOptions();
  const target = String(seconds);
  const exists = NOTIFY_INTERVAL_OPTIONS.some((option) => String(option.value) === target);
  if (exists) {
    refs.notifyInterval.value = target;
    return;
  }
  if (!refs.notifyInterval.querySelector(`option[data-custom="1"]`)) {
    const customOption = document.createElement("option");
    customOption.value = target;
    customOption.textContent = `${seconds} 秒（自定义）`;
    customOption.dataset.custom = "1";
    refs.notifyInterval.appendChild(customOption);
  } else {
    const customOption = refs.notifyInterval.querySelector(`option[data-custom="1"]`);
    customOption.value = target;
    customOption.textContent = `${seconds} 秒（自定义）`;
  }
  refs.notifyInterval.value = target;
}

function buildRuleRow(rule = { fieldPath: "", operator: "equals", expectedValue: "" }) {
  const row = document.createElement("div");
  row.className = "notify-rule-row";

  const pathInput = document.createElement("input");
  pathInput.type = "text";
  pathInput.className = "notify-rule-path";
  pathInput.placeholder = "字段路径，如 data.count";
  pathInput.value = rule.fieldPath || "";

  const operatorSelect = document.createElement("select");
  operatorSelect.className = "notify-rule-operator";
  operatorSelect.innerHTML = NOTIFY_OPERATORS
    .map((operator) => `<option value="${operator.value}">${operator.label}</option>`)
    .join("");
  operatorSelect.value = rule.operator || "equals";

  const valueInput = document.createElement("input");
  valueInput.type = "text";
  valueInput.className = "notify-rule-value";
  valueInput.placeholder = "期望值";
  valueInput.value = rule.expectedValue ?? "";

  function syncValueState() {
    const noValue = NOTIFY_OPERATORS_NO_VALUE.has(operatorSelect.value);
    valueInput.disabled = noValue;
    if (noValue) {
      valueInput.value = "";
      valueInput.placeholder = "（不需要期望值）";
    } else {
      valueInput.placeholder = "期望值";
    }
  }
  operatorSelect.addEventListener("change", syncValueState);
  syncValueState();

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "ghost-btn small";
  removeBtn.innerHTML = "🗑️";
  removeBtn.title = "移除规则";
  removeBtn.addEventListener("click", () => {
    row.remove();
    ensureRuleEmptyHint();
  });

  row.append(pathInput, operatorSelect, valueInput, removeBtn);
  return row;
}

function ensureRuleEmptyHint() {
  if (!refs.notifyRulesList) return;
  const rows = refs.notifyRulesList.querySelectorAll(".notify-rule-row");
  const hint = refs.notifyRulesList.querySelector(".notify-empty-rule");
  if (rows.length === 0) {
    if (!hint) {
      const placeholder = document.createElement("div");
      placeholder.className = "notify-empty-rule";
      placeholder.textContent = "暂无规则。命中规则为空时该监听不会触发通知。";
      refs.notifyRulesList.appendChild(placeholder);
    }
  } else if (hint) {
    hint.remove();
  }
}

function addRuleRow(rule) {
  populateNotifyIntervalOptions();
  if (!refs.notifyRulesList) return;
  const row = buildRuleRow(rule);
  refs.notifyRulesList.appendChild(row);
  ensureRuleEmptyHint();
}

function collectRules() {
  if (!refs.notifyRulesList) return { matchMode: "all", items: [] };
  const rows = Array.from(refs.notifyRulesList.querySelectorAll(".notify-rule-row"));
  const items = rows
    .map((row) => {
      const fieldPath = row.querySelector(".notify-rule-path")?.value.trim() || "";
      const operator = row.querySelector(".notify-rule-operator")?.value || "equals";
      const noValue = NOTIFY_OPERATORS_NO_VALUE.has(operator);
      const expectedValueRaw = row.querySelector(".notify-rule-value")?.value ?? "";
      const expectedValue = noValue ? "" : expectedValueRaw;
      return { fieldPath, operator, expectedValue };
    })
    .filter((item) => item.fieldPath);
  return { matchMode: refs.notifyMatchMode?.value || "all", items };
}

function resetNotifyForm() {
  if (!refs.notifyMonitorForm) return;
  refs.notifyMonitorForm.reset();
  refs.notifyEditId.value = "";
  refs.notifyMonitorType.value = "http";
  refs.notifyEnabled.value = "1";
  refs.notifyMethod.value = "GET";
  refs.notifyBrowserPageUrl.value = "";
  refs.notifyBrowserReadySelector.value = "";
  refs.notifyBrowserWaitMs.value = "10000";
  refs.notifyTimeout.value = "15";
  refs.notifyCooldown.value = "0";
  refs.notifyMatchMode.value = "all";
  refs.notifyRulesList.innerHTML = "";
  ensureRuleEmptyHint();
  setNotifyIntervalValue(60);
  refs.notifyFormTitle.textContent = "添加监听";
  refs.notifySubmitBtn.textContent = "添加监听";
  refs.notifyTestRunBtn.classList.add("hidden");
  refs.notifyFormCancel.classList.add("hidden");
  setStatusMessage(refs.notifyFormResult, "");
  syncNotifyModeUi();
}

function fillNotifyForm(monitor) {
  populateNotifyIntervalOptions();
  refs.notifyEditId.value = monitor.id;
  refs.notifyName.value = monitor.name || "";
  refs.notifyMonitorType.value = monitor.monitorType || "http";
  refs.notifyEnabled.value = monitor.enabled ? "1" : "0";
  refs.notifyMethod.value = monitor.httpMethod || "GET";
  refs.notifyUrl.value = monitor.requestUrl || "";
  refs.notifyBrowserPageUrl.value = monitor.browserPageUrl || "";
  refs.notifyBrowserReadySelector.value = monitor.browserReadySelector || "";
  refs.notifyBrowserWaitMs.value = monitor.browserWaitMs || 10000;
  refs.notifyHeaders.value = monitor.headersJson || "";
  refs.notifyBody.value = monitor.bodyJson || "";
  refs.notifyWatchFields.value = (monitor.watchFields || []).join(", ");
  refs.notifyWebhookOverride.value = monitor.feishuWebhookOverride || "";
  refs.notifyTitle.value = monitor.notifyTitle || "";
  refs.notifyTimeout.value = monitor.timeoutSeconds || 15;
  refs.notifyCooldown.value = monitor.cooldownSeconds || 0;
  refs.notifyMatchMode.value = monitor.rules?.matchMode || "all";
  refs.notifyRulesList.innerHTML = "";
  (monitor.rules?.items || []).forEach((rule) => addRuleRow(rule));
  ensureRuleEmptyHint();
  setNotifyIntervalValue(monitor.intervalSeconds || 60);
  refs.notifyFormTitle.textContent = `编辑监听：${monitor.name}`;
  refs.notifySubmitBtn.textContent = "保存修改";
  refs.notifyTestRunBtn.classList.remove("hidden");
  refs.notifyFormCancel.classList.remove("hidden");
  setStatusMessage(refs.notifyFormResult, "");
  syncNotifyModeUi();
  refs.notifyName.focus();
}

function formatLastStatus(value) {
  const map = {
    notified: "已通知",
    matched: "已命中",
    matched_cooldown: "命中(冷却)",
    matched_no_webhook: "命中(无Webhook)",
    no_match: "未命中",
    http_error: "HTTP 异常",
    error: "请求异常",
    send_error: "通知失败"
  };
  return map[value] || value || "-";
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "¥0";
  const rounded = Math.round((number + Number.EPSILON) * 10000) / 10000;
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `¥${text}`;
}

async function refreshNotificationSettings() {
  if (!refs.notifyGlobalWebhook) return;
  const payload = await api("/api/admin/notifications/settings");
  refs.notifyGlobalWebhook.value = payload.globalFeishuWebhook || "";
}

async function refreshNotificationMonitors() {
  if (!refs.notifyMonitorList) return;
  const payload = await api("/api/admin/notifications/monitors");
  notifyMonitorsCache = payload.items || [];

  renderTable(refs.notifyMonitorList, [
    {
      label: "名称",
      render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><span style="font-size:11px;color:var(--muted)">${item.monitorType === "browser" ? "浏览器模式" : "HTTP 直连"}${item.notifyTitle ? ` · ${escapeHtml(item.notifyTitle)}` : ""}</span>`
    },
    {
      label: "接口",
      render: (item) => `<code style="font-size:11px">${escapeHtml(item.httpMethod)} ${escapeHtml(item.requestUrl)}</code>`
    },
    {
      label: "周期",
      render: (item) => `${item.intervalSeconds} 秒`
    },
    {
      label: "规则",
      render: (item) => `${item.rules?.items?.length || 0} 条 (${item.rules?.matchMode === "any" ? "任一命中" : "全部命中"})`
    },
    {
      label: "Webhook",
      render: (item) => item.feishuWebhookOverride ? "覆盖" : "全局"
    },
    {
      label: "状态",
      render: (item) => item.enabled ? renderStatus("active") : renderStatus("disabled")
    },
    {
      label: "最近执行",
      render: (item) => `
        <div style="font-size:11px;line-height:1.4">
          <div>${item.lastRunAt ? escapeHtml(item.lastRunAt) : "未执行"}</div>
          <div style="color:var(--muted)">${escapeHtml(formatLastStatus(item.lastStatus))}${item.lastError ? ` · ${escapeHtml(item.lastError.slice(0, 40))}` : ""}</div>
        </div>
      `
    },
    {
      label: "操作",
      render: (item) => `
        <button class="primary-btn small" type="button" onclick="editNotifyMonitor('${escapeHtml(item.id)}')">编辑</button>
        <button class="ghost-btn small" style="padding:6px 12px;font-size:12px" type="button" onclick="toggleNotifyMonitor('${escapeHtml(item.id)}', ${item.enabled ? 0 : 1})">${item.enabled ? "停用" : "启用"}</button>
        <button class="ghost-btn small" style="padding:6px 12px;font-size:12px" type="button" onclick="testNotifyMonitor('${escapeHtml(item.id)}')">测试</button>
        <button class="ghost-btn small" style="padding:6px 12px;font-size:12px;color:var(--error)" type="button" onclick="deleteNotifyMonitor('${escapeHtml(item.id)}')">删除</button>
      `
    }
  ], notifyMonitorsCache, "暂无监听项");
}

async function refreshNotificationEvents() {
  if (!refs.notifyEventList) return;
  const payload = await api("/api/admin/notifications/events?limit=80");
  renderTable(refs.notifyEventList, [
    { label: "时间", render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt)}</span>` },
    { label: "监听", render: (item) => escapeHtml(item.monitorName || "-") },
    {
      label: "类型",
      render: (item) => {
        const label = NOTIFY_EVENT_LABELS[item.eventType] || item.eventType;
        const cls = item.eventType === "matched" || item.eventType === "send_ok"
          ? "status-succeeded"
          : item.eventType === "fetch_error" || item.eventType === "send_error"
            ? "status-failed"
            : item.eventType === "test"
              ? "status-pending"
              : "status-disabled";
        return `<span class="table-badge ${cls}">${escapeHtml(label)}</span>`;
      }
    },
    {
      label: "摘要",
      render: (item) => `<span class="event-summary" title="${escapeHtml(item.summary || "")}">${escapeHtml(item.summary || "-")}</span>`
    }
  ], payload.items || [], "暂无通知事件");
}

async function refreshNotifications() {
  await Promise.all([
    refreshNotificationSettings().catch(() => {}),
    refreshNotificationMonitors().catch(() => {}),
    refreshNotificationEvents().catch(() => {})
  ]);
}

function editNotifyMonitor(id) {
  const monitor = notifyMonitorsCache.find((item) => item.id === id);
  if (!monitor) return;
  fillNotifyForm(monitor);
  refs.notifyMonitorForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function toggleNotifyMonitor(id, nextEnabled) {
  try {
    await api(`/api/admin/notifications/monitors/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !!nextEnabled })
    });
    await refreshNotifications();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteNotifyMonitor(id) {
  if (!window.confirm("确认删除该监听项？删除后历史事件仍会保留。")) return;
  try {
    await api(`/api/admin/notifications/monitors/${id}`, { method: "DELETE", body: JSON.stringify({}) });
    if (refs.notifyEditId.value === id) resetNotifyForm();
    await refreshNotifications();
  } catch (error) {
    alert(error.message);
  }
}

async function testNotifyMonitor(id) {
  try {
    setStatusMessage(refs.notifyFormResult, "正在测试执行监听，请稍候...", "info");
    setButtonBusy(refs.notifyTestRunBtn, true, "测试中...");
    const result = await api(`/api/admin/notifications/monitors/${id}/test-run`, {
      method: "POST",
      body: JSON.stringify({})
    });
    const matched = result.ruleResult?.matched;
    const status = result.response?.status;
    const summary = matched ? "命中规则" : "未命中规则";
    setStatusMessage(refs.notifyFormResult, `测试完成（HTTP ${status}）：${summary}`, matched ? "success" : "info");
    await refreshNotificationEvents().catch(() => {});
  } catch (error) {
    setStatusMessage(refs.notifyFormResult, `测试失败：${error.message}`, "error");
  } finally {
    setButtonBusy(refs.notifyTestRunBtn, false);
  }
}

window.editNotifyMonitor = editNotifyMonitor;
window.toggleNotifyMonitor = toggleNotifyMonitor;
window.deleteNotifyMonitor = deleteNotifyMonitor;
window.testNotifyMonitor = testNotifyMonitor;

function getCheckedValues(selector) {
  return Array.from(document.querySelectorAll(selector))
    .filter((element) => element.checked)
    .map((element) => element.value);
}

function getSelectedCdkeyIds() {
  return getCheckedValues(".cdkey-check");
}

function formatKeysForClipboard(keys) {
  return keys.map((key) => String(key).trimEnd()).join("\n");
}

async function exportPublicKeys() {
  const ids = getSelectedCdkeyIds();
  if (!ids.length) {
    alert("请先选择卡密");
    return;
  }

  const rows = Array.from(document.querySelectorAll(".cdkey-check"))
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => {
      const row = checkbox.closest("tr");
      const codeEl = row?.querySelector("td:nth-child(2) code");
      return codeEl ? codeEl.textContent : "";
    })
    .filter(Boolean);

  const text = formatKeysForClipboard(rows);
  try {
    await navigator.clipboard.writeText(text);
    alert(`已复制 ${rows.length} 条公开卡密`);
  } catch (_) {
    alert("导出失败：剪贴板写入被拒绝");
  }
}

async function exportSourceKeys() {
  const ids = getSelectedCdkeyIds();
  if (!ids.length) {
    alert("请先选择卡密");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const payload = await api("/api/admin/cdkeys/export-source-keys", {
      method: "POST",
      body: JSON.stringify({ ids }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const keys = (payload.items || []).map((item) => item.sourceKey);
    const text = formatKeysForClipboard(keys);
    await navigator.clipboard.writeText(text);
    alert(`已复制 ${keys.length} 条原始卡密`);
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      alert("导出失败：请求超时");
    } else {
      alert(`导出失败：${error.message}`);
    }
  }
}

function generateExcelFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `cdkeys_export_${stamp}.xlsx`;
}

async function exportCdkeysExcel() {
  const params = new URLSearchParams();
  const statusEl = document.querySelector("#cdkey-filter-status");
  const siteEl = document.querySelector("#cdkey-filter-site");
  const batchEl = document.querySelector("#cdkey-filter-batch");
  const keywordEl = document.querySelector("#cdkey-filter-keyword");

  if (statusEl && statusEl.value) params.set("status", statusEl.value);
  if (siteEl && siteEl.value) params.set("siteId", siteEl.value);
  if (batchEl && batchEl.value) params.set("batchId", batchEl.value);
  if (keywordEl && keywordEl.value.trim()) params.set("q", keywordEl.value.trim());

  const qs = params.toString();
  const url = "/api/admin/cdkeys/export-excel" + (qs ? "?" + qs : "");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const payload = await api(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!payload.items || !payload.items.length) {
      alert("无数据可导出");
      return;
    }

    const rows = payload.items.map((item) => ({
      "公开卡密": item.public_key || "",
      "原始卡密": item.source_key || "",
      "来源": ({ store_order: "商城订单签发", batch_import: "批量导入", admin_create: "后台创建" })[item.origin] || item.origin || "",
      "商城订单号": item.store_order_no || "",
      "交付子单号": item.store_fulfillment_target_no || "",
      "前缀": item.prefix || "",
      "状态": item.status || "",
      "网站": item.site_name || "",
      "批次": item.batch_name || "",
      "接码Token": item.email_token || "",
      "创建时间": item.created_at || ""
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "卡密数据");
    XLSX.writeFile(wb, generateExcelFilename());
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      alert("导出失败：请求超时");
    } else {
      alert(`导出失败：${error.message}`);
    }
  }
}

// ── Quota System ──

async function refreshQuotaDashboard() {
  if (!refs.quotaStats) return;
  try {
    const payload = await api("/api/admin/quota/dashboard");
    const cards = [
      ["总额度", payload.totalQuota ?? 0],
      ["可分配额度", payload.availableQuota ?? 0],
      ["已分配额度", payload.allocatedQuota ?? 0],
      ["活跃子卡密数", payload.activeSubCards ?? 0]
    ];
    refs.quotaStats.innerHTML = cards.map(([label, value]) => `
      <article class="stat">
        <span>${label}</span>
        <strong>${value}</strong>
      </article>
    `).join("");
  } catch (error) {
    refs.quotaStats.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
  }
}

function renderQuotaImportResults(result) {
  if (!refs.quotaImportDetailCard || !refs.quotaImportDetail) return;
  refs.quotaImportDetailCard.classList.remove("hidden");

  const summaryHtml = `
    <div style="margin-bottom:16px;">
      <span class="table-badge status-active">成功 ${result.successCount ?? 0}</span>
      <span class="table-badge status-failed" style="margin-left:8px">失败 ${result.failedCount ?? 0}</span>
    </div>
  `;

  if (!result.failures || result.failures.length === 0) {
    refs.quotaImportDetail.innerHTML = summaryHtml + `<p class="hint centered">全部导入成功</p>`;
  } else {
    const failRows = result.failures.map((f) => `
    <tr>
      <td><code>${escapeHtml(f.code || f.cardCode || "-")}</code></td>
      <td>${escapeHtml(f.reason || f.error || "未知原因")}</td>
    </tr>
  `).join("");

    refs.quotaImportDetail.innerHTML = summaryHtml + `
    <table>
      <thead><tr><th>卡密</th><th>失败原因</th></tr></thead>
      <tbody>${failRows}</tbody>
    </table>
  `;
  }

  // Bug B fix: when the response carries mergeResult (alias: `merge`), append a
  // "合并后的卡密" section. When it is null/undefined, the DOM above is left
  // byte-identical to the original implementation (preservation 3.9).
  const mergeResult = result.mergeResult ?? result.merge ?? null;
  if (mergeResult == null) return;

  let mergedHtml;
  if (mergeResult.success === true) {
    const newCode = String(mergeResult.newCode ?? "");
    const masked = newCode.length > 8
      ? `${newCode.slice(0, 4)}...${newCode.slice(-4)}`
      : (newCode || "-");
    const mergedCardId = String(mergeResult.mergedCardId ?? "");
    const totalRemaining = mergeResult.totalRemaining ?? 0;
    mergedHtml = `
    <div class="quota-merged-section" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
      <h4 style="margin:0 0 8px 0;">合并后的卡密</h4>
      <p><span class="table-badge status-active">合并成功</span></p>
      <p>新卡密：<code title="${escapeHtml(newCode)}">${escapeHtml(masked)}</code></p>
      <p>总剩余额度：${escapeHtml(String(totalRemaining))}</p>
      <p>当前额度：<span class="merged-quota">-</span> / 剩余：<span class="merged-remaining">-</span> / 状态：<span class="merged-used">-</span></p>
      <button class="primary-btn small" type="button" data-merged-card-id="${escapeHtml(mergedCardId)}">刷新额度</button>
    </div>
  `;
  } else {
    const errorMsg = mergeResult.error || "未知错误";
    mergedHtml = `
    <div class="quota-merged-section" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
      <h4 style="margin:0 0 8px 0;">合并后的卡密</h4>
      <p>合并失败：${escapeHtml(errorMsg)}</p>
    </div>
  `;
  }

  refs.quotaImportDetail.insertAdjacentHTML("beforeend", mergedHtml);

  // Wire refresh button click. The handler is introduced by Task 3.4
  // (handleMergedCardRefresh); guard so this renderer remains usable on its own.
  if (mergeResult.success === true && typeof handleMergedCardRefresh === "function") {
    const button = refs.quotaImportDetail.querySelector("[data-merged-card-id]");
    if (button) button.addEventListener("click", handleMergedCardRefresh);
  }
}

// Bug C fix: 通过 admin 后端代理接口刷新合并卡密的最新 quota / remaining / used。
// 浏览器只命中 /api/admin/quota/cards/verify，外部域名由后端代理屏蔽
// (preservation §2 — admin 浏览器代码不得包含外部主机字面量)。
async function handleMergedCardRefresh(event) {
  const button = event.currentTarget;
  if (!button) return;

  const cardId = button.dataset.mergedCardId;
  if (!cardId) return;

  const section = button.closest(".quota-merged-section") || refs.quotaImportDetail;

  // Clean up any previous error message before the new attempt.
  if (section) {
    const existingError = section.querySelector(".merged-refresh-error");
    if (existingError) existingError.remove();
  }

  setButtonBusy(button, true, "刷新中...");
  try {
    const payload = await api("/api/admin/quota/cards/verify", {
      method: "POST",
      body: JSON.stringify({ cardId })
    });

    if (section) {
      const quotaEl = section.querySelector(".merged-quota");
      const remainingEl = section.querySelector(".merged-remaining");
      const usedEl = section.querySelector(".merged-used");
      if (quotaEl) quotaEl.textContent = payload.quota ?? "-";
      if (remainingEl) remainingEl.textContent = payload.remaining ?? "-";
      if (usedEl) usedEl.textContent = payload.used ? "已使用" : "未使用";
    }
  } catch (error) {
    if (section) {
      const errorEl = document.createElement("p");
      errorEl.className = "merged-refresh-error hint";
      errorEl.style.color = "var(--danger, #b00020)";
      errorEl.style.marginTop = "8px";
      errorEl.textContent = `刷新失败：${error.message || "未知错误"}`;
      button.insertAdjacentElement("afterend", errorEl);
    }
  } finally {
    setButtonBusy(button, false);
  }
}

// Expose for inline onclick-style discovery and so renderQuotaImportResults'
// `typeof handleMergedCardRefresh === "function"` guard always succeeds.
window.handleMergedCardRefresh = handleMergedCardRefresh;

// ── Quota Source-Card Manual Merge ──
// 用于补救历史导入未自动合并的情况：列出 active 源卡密，选 >=2 张调用
// /api/admin/quota/cards/merge，复用 renderQuotaImportResults 展示合并结果
// （包含掩码 newCode、totalRemaining、刷新额度按钮）。

function syncQuotaSourceCardsMergeButton() {
  if (!refs.quotaSourceCardList || !refs.quotaSourceCardsMergeBtn) return;
  const checked = refs.quotaSourceCardList.querySelectorAll(
    "input[type=checkbox][data-source-card-id]:checked"
  );
  refs.quotaSourceCardsMergeBtn.disabled = checked.length < 2;
}

async function refreshQuotaSourceCards() {
  if (!refs.quotaSourceCardList) return;
  try {
    const payload = await api("/api/admin/quota/cards?status=active&pageSize=100");
    const items = payload.cards || payload.items || [];
    if (!items.length) {
      refs.quotaSourceCardList.innerHTML = `<p class="hint centered">暂无可用源卡密</p>`;
    } else {
      renderTable(refs.quotaSourceCardList, [
        { label: "", render: (item) => `<input type="checkbox" class="quota-source-card-check" value="${escapeHtml(item.id)}" />` },
        { label: "API Key", render: (item) => `<code>${escapeHtml(item.sourceKey || item.id)}</code>` },
        { label: "总余额", render: (item) => item.quota ?? 0 },
        { label: "剩余额度", render: (item) => item.remaining ?? 0 },
        {
          label: "保存时间",
          render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt || "-")}</span>`,
        },
        { label: "状态", render: (item) => renderStatus(item.status) },
        {
          label: "操作",
          render: (item) => `<button class="ghost-btn small" type="button" onclick="editQuotaSourceCard('${escapeHtml(item.id)}')">修改</button> <button class="ghost-btn small" type="button" onclick="deleteQuotaSourceCard('${escapeHtml(item.id)}')">删除</button>`,
        },
      ], items, "暂无可用 API 密钥");
    }
  } catch (error) {
    refs.quotaSourceCardList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
  }
  syncQuotaSourceCardsMergeButton();
}

async function handleQuotaSourceCardsMerge() {
  if (!refs.quotaSourceCardList || !refs.quotaSourceCardsMergeBtn) return;
  const cardIds = Array.from(
    refs.quotaSourceCardList.querySelectorAll("input[type=checkbox][data-source-card-id]:checked")
  ).map((cb) => cb.dataset.sourceCardId);
  if (cardIds.length < 2) {
    setHint(refs.quotaSourceCardsMergeResult, "至少选择 2 张卡密");
    return;
  }
  if (!window.confirm(`确认合并 ${cardIds.length} 张可用卡密？原卡密会被标记为已使用，新建一张合并卡密。`)) {
    return;
  }
  setButtonBusy(refs.quotaSourceCardsMergeBtn, true, "合并中...");
  setHint(refs.quotaSourceCardsMergeResult, "");
  try {
    const payload = await api("/api/admin/quota/cards/merge", {
      method: "POST",
      body: JSON.stringify({ cardIds }),
    });
    // 复用导入流程的渲染（自带掩码 newCode / totalRemaining / 刷新额度按钮），
    // payload 形如 { success, mergedCardId, newCode, totalRemaining }，
    // 包装为 renderQuotaImportResults 期望的 { mergeResult, ... } 形状。
    renderQuotaImportResults({
      successCount: cardIds.length,
      failedCount: 0,
      failures: [],
      mergeResult: payload,
    });
    setHint(refs.quotaSourceCardsMergeResult, "合并成功");
    await refreshQuotaSourceCards();
    await refreshQuotaDashboard();
  } catch (error) {
    setHint(refs.quotaSourceCardsMergeResult, `合并失败：${error.message}`);
  } finally {
    setButtonBusy(refs.quotaSourceCardsMergeBtn, false);
  }
}

// ── Quota Sub-Card Management ──

function getSelectedQuotaSourceCardIds() {
  return getCheckedValues(".quota-source-card-check");
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportQuotaSourceCards(exportAll = false) {
  const ids = exportAll ? [] : getSelectedQuotaSourceCardIds();
  if (!exportAll && !ids.length) {
    setHint(refs.quotaSourceCardsMergeResult, "请先选择要导出的 API 密钥");
    return;
  }
  try {
    const payload = await api("/api/admin/quota/cards/export", {
      method: "POST",
      body: JSON.stringify(exportAll ? { all: true } : { ids })
    });
    const keys = (payload.items || []).map((item) => item.apiKey).filter(Boolean);
    downloadTextFile(`quota-api-keys-${new Date().toISOString().slice(0, 10)}.txt`, keys.join("\n"));
    setHint(refs.quotaSourceCardsMergeResult, `已导出 ${keys.length} 个 API 密钥`);
  } catch (error) {
    setHint(refs.quotaSourceCardsMergeResult, `导出失败：${error.message}`);
  }
}

async function editQuotaSourceCard(id) {
  const apiKey = window.prompt("请输入新的 API 密钥：");
  if (apiKey === null) return;
  const trimmed = apiKey.trim();
  if (!trimmed) {
    setHint(refs.quotaSourceCardsMergeResult, "API 密钥不能为空");
    return;
  }
  try {
    await api(`/api/admin/quota/cards/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ apiKey: trimmed })
    });
    setHint(refs.quotaSourceCardsMergeResult, "API 密钥已修改");
    await refreshQuotaSourceCards();
    await refreshQuotaDashboard();
  } catch (error) {
    setHint(refs.quotaSourceCardsMergeResult, `修改失败：${error.message}`);
  }
}

async function deleteQuotaSourceCard(id) {
  if (!window.confirm("确认删除这个 API 密钥？删除后将不再作为提号源。")) return;
  try {
    await api(`/api/admin/quota/cards/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({}) });
    setHint(refs.quotaSourceCardsMergeResult, "API 密钥已删除");
    await refreshQuotaSourceCards();
    await refreshQuotaDashboard();
  } catch (error) {
    setHint(refs.quotaSourceCardsMergeResult, `删除失败：${error.message}`);
  }
}

window.editQuotaSourceCard = editQuotaSourceCard;
window.deleteQuotaSourceCard = deleteQuotaSourceCard;

function renderQuotaSubCardPagination() {
  if (!refs.quotaSubCardPagination) return;
  const total = quotaSubCardState.total;
  const pageSize = Math.max(1, quotaSubCardState.pageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, quotaSubCardState.page), totalPages);
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, page * pageSize);

  refs.quotaSubCardPagination.innerHTML = `
    <div class="pagination-summary">显示 ${start}-${end} / ${total} 张子卡密</div>
    <div class="pagination-actions">
      <button class="ghost-btn small" type="button" data-quota-sub-page="1" ${page <= 1 ? "disabled" : ""}>首页</button>
      <button class="ghost-btn small" type="button" data-quota-sub-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>
      <span class="pagination-page">第 ${page} / ${totalPages} 页</span>
      <button class="ghost-btn small" type="button" data-quota-sub-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>
      <button class="ghost-btn small" type="button" data-quota-sub-page="${totalPages}" ${page >= totalPages ? "disabled" : ""}>末页</button>
    </div>
  `;
}

async function refreshQuotaSubCards(page = quotaSubCardState.page) {
  if (!refs.quotaSubCardList) return;
  try {
    quotaSubCardState.page = Math.max(1, Math.floor(Number(page) || 1));
    const params = new URLSearchParams({
      page: String(quotaSubCardState.page),
      pageSize: String(quotaSubCardState.pageSize)
    });
    if (quotaSubCardState.status) {
      params.set("status", quotaSubCardState.status);
    }

    const payload = await api(`/api/admin/quota/sub-cards?${params.toString()}`);
    const items = payload.subCards || [];
    const total = Number(payload.total ?? items.length);
    const responsePageSize = Number(payload.pageSize ?? quotaSubCardState.pageSize);
    const responsePage = Number(payload.page ?? quotaSubCardState.page);
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, responsePageSize)));
    const normalizedPage = Math.min(Math.max(1, responsePage), totalPages);

    quotaSubCardState.total = total;
    quotaSubCardState.pageSize = responsePageSize;
    quotaSubCardState.page = normalizedPage;

    if (total > 0 && responsePage !== normalizedPage) {
      await refreshQuotaSubCards(normalizedPage);
      return;
    }

    renderTable(refs.quotaSubCardList, [
      { label: "", render: (item) => `<input type="checkbox" class="quota-sub-check" value="${escapeHtml(item.id)}" data-code="${escapeHtml(item.cardCode)}" data-total="${item.totalQuota ?? 0}" data-used="${item.usedQuota ?? 0}" data-status="${escapeHtml(item.status)}" />` },
      { label: "编码", render: (item) => `<code>${escapeHtml(item.cardCode)}</code>` },
      { label: "总额度", render: (item) => item.totalQuota ?? 0 },
      { label: "已用额度", render: (item) => item.usedQuota ?? 0 },
      { label: "剩余", render: (item) => {
        const total = item.totalQuota ?? 0;
        const used = item.usedQuota ?? 0;
        return total - used;
      }},
      { label: "状态", render: (item) => renderStatus(item.status) },
      { label: "操作", render: (item) => `
        <button class="primary-btn small" type="button" onclick="viewQuotaSubCardDetail('${escapeHtml(item.id)}')">详情</button>
        ${item.status === "active" ? `<button class="ghost-btn small" style="padding:6px 12px;font-size:12px;color:var(--error)" type="button" onclick="cancelQuotaSubCard('${escapeHtml(item.id)}')">取消</button>` : ""}
        ${item.status === "locked" ? `<button class="ghost-btn small" style="padding:6px 12px;font-size:12px" type="button" onclick="unlockQuotaSubCard('${escapeHtml(item.id)}')">恢复</button>` : ""}
      ` }
    ], items, "暂无子卡密");
    renderQuotaSubCardPagination();
  } catch (error) {
    refs.quotaSubCardList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
    if (refs.quotaSubCardPagination) refs.quotaSubCardPagination.innerHTML = "";
  }
}

async function viewQuotaSubCardDetail(id) {
  if (!refs.quotaSubCardDetailCard || !refs.quotaSubCardDetail || !refs.quotaSubCardHistory) return;
  refs.quotaSubCardDetailCard.classList.remove("hidden");

  try {
    const detail = await api(`/api/admin/quota/sub-cards/${id}`);
    const total = detail.total_quota ?? detail.totalQuota ?? 0;
    const used = detail.used_quota ?? detail.usedQuota ?? 0;
    const remaining = total - used;

    refs.quotaSubCardDetail.innerHTML = `
      <table>
        <thead><tr><th>编码</th><th>总额度</th><th>已用额度</th><th>剩余额度</th><th>状态</th><th>创建时间</th></tr></thead>
        <tbody>
          <tr>
            <td><code>${escapeHtml(detail.card_code || detail.cardCode)}</code></td>
            <td>${total}</td>
            <td>${used}</td>
            <td>${remaining}</td>
            <td>${renderStatus(detail.status)}</td>
            <td><span style="font-size:12px">${escapeHtml(detail.created_at || detail.createdAt || "-")}</span></td>
          </tr>
        </tbody>
      </table>
    `;
  } catch (error) {
    refs.quotaSubCardDetail.innerHTML = `<p class="hint centered">加载详情失败：${escapeHtml(error.message)}</p>`;
  }

  try {
    const historyPayload = await api(`/api/admin/quota/sub-cards/${id}/history`);
    const history = historyPayload.history || historyPayload.items || [];
    renderTable(refs.quotaSubCardHistory, [
      { label: "提取时间", render: (item) => `<span style="font-size:12px">${escapeHtml(item.created_at || item.createdAt || item.claimedAt || "-")}</span>` },
      { label: "提取数量", render: (item) => item.amount ?? item.chargedQuota ?? 0 },
      { label: "账号数量", render: (item) => item.account_count ?? item.accountCount ?? 0 },
      { label: "提取内容", render: (item) => {
        const accounts = item.accounts || [];
        if (!accounts.length) return `<span style="color:var(--muted)">-</span>`;
        return `<code style="font-size:11px;word-break:break-all;white-space:pre-wrap">${escapeHtml(accounts.join("\n"))}</code>`;
      }}
    ], history, "暂无提取记录");
  } catch (error) {
    refs.quotaSubCardHistory.innerHTML = `<p class="hint centered">加载历史失败：${escapeHtml(error.message)}</p>`;
  }

  refs.quotaSubCardDetailCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function cancelQuotaSubCard(id) {
  if (!window.confirm("确认取消该子卡密？取消后剩余额度将归还到可分配额度池中。")) return;
  try {
    await api(`/api/admin/quota/sub-cards/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
    await refreshQuotaSubCards();
    await refreshQuotaDashboard();
  } catch (error) {
    alert(`取消失败：${error.message}`);
  }
}

async function unlockQuotaSubCard(id) {
  if (!window.confirm("确认把这张已锁定子卡密恢复为可用？")) return;
  try {
    await api(`/api/admin/quota/sub-cards/${id}/unlock`, { method: "POST", body: JSON.stringify({}) });
    setHint(refs.quotaSubCardResult, "子卡密已恢复为可用");
    await refreshQuotaSubCards();
  } catch (error) {
    setHint(refs.quotaSubCardResult, `恢复失败：${error.message}`);
  }
}

window.viewQuotaSubCardDetail = viewQuotaSubCardDetail;
window.cancelQuotaSubCard = cancelQuotaSubCard;
window.unlockQuotaSubCard = unlockQuotaSubCard;

const SHAKE_SOURCE_LABELS = {
  subscription_purchase: "本站套餐购买",
  balance_consumption: "余额实际消耗"
};
const SHAKE_PRIZE_TYPE_LABELS = {
  balance: "余额",
  extra_draw: "再抽一次",
  empty: "谢谢参与"
};
const SHAKE_RARITY_LABELS = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说"
};
const SHAKE_CARD_TIER_LABELS = {
  low: "低级抽奖卡",
  medium: "中级抽奖卡",
  high: "高级抽奖卡"
};

function toDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function collectShakePrizes() {
  if (!refs.shakePrizeEditor) return [];
  return Array.from(refs.shakePrizeEditor.querySelectorAll("[data-shake-prize-row]")).map((row, index) => {
    const type = row.querySelector("[data-field=type]").value;
    return {
      name: row.querySelector("[data-field=name]").value.trim(),
      type,
      amount: type === "balance" ? Number(row.querySelector("[data-field=amount]").value) : undefined,
      weights: {
        low: Number(row.querySelector("[data-field=lowWeight]").value),
        medium: Number(row.querySelector("[data-field=mediumWeight]").value),
        high: Number(row.querySelector("[data-field=highWeight]").value)
      },
      rarity: row.querySelector("[data-field=rarity]").value,
      displayText: row.querySelector("[data-field=displayText]").value.trim(),
      icon: row.querySelector("[data-field=icon]").value.trim(),
      sortOrder: (index + 1) * 10
    };
  });
}

function collectShakeSubscriptionRules() {
  if (!refs.shakeSubscriptionRuleEditor) return [];
  return Array.from(refs.shakeSubscriptionRuleEditor.querySelectorAll("[data-shake-subscription-rule-row]")).map((row) => ({
    source: "subscription_purchase",
    subscriptionGroupId: row.querySelector("[data-field=subscriptionGroupId]").value.trim(),
    cardTier: row.querySelector("[data-field=cardTier]").value,
    cardQuantity: row.querySelector("[data-field=cardQuantity]").value.trim()
  }));
}

function renderShakeSubscriptionRuleEditor(rules = []) {
  if (!refs.shakeSubscriptionRuleEditor) return;
  refs.shakeSubscriptionRuleEditor.innerHTML = rules.map((rule, index) => `
    <div class="shake-subscription-rule-row" data-shake-subscription-rule-row>
      <label class="field"><span>订阅分组 ID</span><input data-field="subscriptionGroupId" type="number" min="1" step="1" value="${escapeHtml(rule.subscriptionGroupId ?? "")}" placeholder="例如 38" required /></label>
      <label class="field"><span>获得卡种</span><select data-field="cardTier">
        ${Object.entries(SHAKE_CARD_TIER_LABELS).map(([value, label]) => `<option value="${value}" ${rule.cardTier === value ? "selected" : ""}>${label}</option>`).join("")}
      </select></label>
      <label class="field"><span>每次购买发放张数</span><input data-field="cardQuantity" type="number" min="1" max="100" step="1" value="${escapeHtml(rule.cardQuantity ?? 1)}" required /></label>
      <button type="button" class="icon-btn" data-remove-subscription-rule="${index}" title="删除规则" aria-label="删除规则">×</button>
    </div>
  `).join("");
}

function collectShakeUsageRules() {
  if (!refs.shakeUsageRuleEditor) return [];
  return Array.from(refs.shakeUsageRuleEditor.querySelectorAll("[data-shake-usage-rule-row]")).map((row) => ({
    source: "balance_consumption",
    subscriptionGroupId: row.querySelector("[data-field=usageSubscriptionGroupId]").value.trim(),
    threshold: row.querySelector("[data-field=usageThreshold]").value.trim(),
    cardTier: row.querySelector("[data-field=usageCardTier]").value
  }));
}

function renderShakeUsageRuleEditor(rules = []) {
  if (!refs.shakeUsageRuleEditor) return;
  refs.shakeUsageRuleEditor.innerHTML = rules.map((rule, index) => `
    <div class="shake-usage-rule-row" data-shake-usage-rule-row>
      <label class="field"><span>订阅分组 ID</span><input data-field="usageSubscriptionGroupId" type="number" min="1" step="1" value="${escapeHtml(rule.subscriptionGroupId ?? "")}" placeholder="例如 38" required /></label>
      <label class="field"><span>实际消耗金额 / 张</span><input data-field="usageThreshold" type="number" min="0.01" step="0.01" value="${escapeHtml(rule.threshold ?? "")}" placeholder="例如 120" required /></label>
      <label class="field"><span>获得卡种</span><select data-field="usageCardTier">
        ${Object.entries(SHAKE_CARD_TIER_LABELS).map(([value, label]) => `<option value="${value}" ${rule.cardTier === value ? "selected" : ""}>${label}</option>`).join("")}
      </select></label>
      <button type="button" class="icon-btn" data-remove-usage-rule="${index}" title="删除规则" aria-label="删除规则">×</button>
    </div>
  `).join("");
}

function renderShakePrizeEditor(prizes = []) {
  if (!refs.shakePrizeEditor) return;
  const items = prizes.length ? prizes : [{
    name: "谢谢参与", type: "empty", amount: null,
    weights: { low: 1, medium: 1, high: 1 },
    rarity: "common", displayText: "", icon: ""
  }];
  refs.shakePrizeEditor.innerHTML = items.map((prize, index) => `
    <div class="shake-prize-row" data-shake-prize-row>
      <label class="field"><span>名称</span><input data-field="name" maxlength="100" value="${escapeHtml(prize.name || "")}" required /></label>
      <label class="field"><span>类型</span><select data-field="type">
        ${Object.entries(SHAKE_PRIZE_TYPE_LABELS).map(([value, label]) => `<option value="${value}" ${prize.type === value ? "selected" : ""}>${label}</option>`).join("")}
      </select></label>
      <label class="field"><span>金额</span><input data-field="amount" type="number" min="0.01" step="0.01" value="${prize.amount ?? ""}" ${prize.type === "balance" ? "" : "disabled"} /></label>
      <label class="field"><span>低级卡权重</span><input data-field="lowWeight" type="number" min="0" step="0.01" value="${prize.weights?.low ?? prize.weight ?? 1}" required /></label>
      <label class="field"><span>中级卡权重</span><input data-field="mediumWeight" type="number" min="0" step="0.01" value="${prize.weights?.medium ?? prize.weight ?? 1}" required /></label>
      <label class="field"><span>高级卡权重</span><input data-field="highWeight" type="number" min="0" step="0.01" value="${prize.weights?.high ?? prize.weight ?? 1}" required /></label>
      <label class="field"><span>稀有度</span><select data-field="rarity">
        ${Object.entries(SHAKE_RARITY_LABELS).map(([value, label]) => `<option value="${value}" ${prize.rarity === value ? "selected" : ""}>${label}</option>`).join("")}
      </select></label>
      <label class="field"><span>展示文案</span><input data-field="displayText" maxlength="200" value="${escapeHtml(prize.displayText || "")}" /></label>
      <label class="field"><span>图标 URL / 字符</span><input data-field="icon" maxlength="500" value="${escapeHtml(prize.icon || "")}" /></label>
      <button type="button" class="icon-btn shake-remove-prize" data-remove-prize="${index}" title="删除奖品" aria-label="删除奖品">×</button>
    </div>
  `).join("");
}

function collectShakeConfig() {
  const eligibilityRules = collectShakeSubscriptionRules().map((rule) => ({
    ...rule,
    subscriptionGroupId: Number(rule.subscriptionGroupId),
    cardQuantity: Number(rule.cardQuantity)
  }));
  eligibilityRules.push(...collectShakeUsageRules().map((rule) => ({
    ...rule,
    subscriptionGroupId: Number(rule.subscriptionGroupId),
    threshold: Number(rule.threshold)
  })));
  const balanceThreshold = Number(refs.shakeBalanceThreshold?.value);
  if (balanceThreshold > 0) eligibilityRules.push({
    source: "balance_consumption", cardTier: refs.shakeBalanceTier.value, threshold: balanceThreshold
  });
  if (!eligibilityRules.length) throw new Error("至少启用一条摇摇卡获取规则");
  const prizes = collectShakePrizes();
  if (!prizes.length) throw new Error("至少配置一个奖品");
  return { eligibilityRules, prizes };
}

function updateShakeEmbedUrl() {
  if (!refs.shakeEmbedUrl) return;
  const connectionId = refs.shakeCampaignConnection?.value || refs.shakeCampaignFilter?.value || sub2apiConnectionsCache[0]?.id || "";
  const connection = sub2apiConnectionsCache.find((item) => item.id === connectionId);
  let sub2ApiOrigin = "https://sub.vsakura.top";
  try {
    if (connection?.baseUrl) sub2ApiOrigin = new URL(connection.baseUrl).origin;
  } catch {
    // Keep the official Sub2api origin when an older connection has an invalid URL.
  }
  const url = new URL("/_kwredeem/sub2api-shake.html", sub2ApiOrigin);
  if (connectionId) url.searchParams.set("connectionId", connectionId);
  refs.shakeEmbedUrl.value = url.href;
  if (refs.shakePreviewLink) refs.shakePreviewLink.href = url.href;
}

function resetShakeCampaignForm() {
  if (!refs.shakeCampaignForm) return;
  refs.shakeCampaignForm.reset();
  refs.shakeCampaignEditId.value = "";
  refs.shakeCampaignFormTitle.textContent = "创建活动";
  refs.shakeCampaignSubmitBtn.textContent = "创建活动";
  refs.shakeCampaignResetBtn.classList.add("hidden");
  for (const element of [refs.shakeCampaignConnection, refs.shakeCampaignName, refs.shakeCampaignStart, refs.shakeCampaignEnd]) element.disabled = false;
  if (sub2apiConnectionsCache.length === 1) refs.shakeCampaignConnection.value = sub2apiConnectionsCache[0].id;
  const start = new Date();
  const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
  refs.shakeCampaignStart.value = toDateTimeLocal(start);
  refs.shakeCampaignEnd.value = toDateTimeLocal(end);
  renderShakeSubscriptionRuleEditor([]);
  renderShakeUsageRuleEditor([]);
  renderShakePrizeEditor();
  updateShakeEmbedUrl();
}

function editShakeCampaign(id) {
  const campaign = shakeCampaignsCache.find((item) => item.id === id);
  if (!campaign) return;
  refs.shakeCampaignEditId.value = campaign.id;
  refs.shakeCampaignConnection.value = campaign.connectionId;
  refs.shakeCampaignName.value = campaign.name;
  refs.shakeCampaignStart.value = toDateTimeLocal(campaign.startAt);
  refs.shakeCampaignEnd.value = toDateTimeLocal(campaign.endAt);
  for (const element of [refs.shakeCampaignConnection, refs.shakeCampaignName, refs.shakeCampaignStart, refs.shakeCampaignEnd]) element.disabled = true;
  renderShakeSubscriptionRuleEditor(campaign.eligibilityRules.filter((rule) => (
    rule.source === "subscription_purchase" && rule.subscriptionGroupId
  )));
  renderShakeUsageRuleEditor(campaign.eligibilityRules.filter((rule) => (
    rule.source === "balance_consumption" && rule.subscriptionGroupId
  )));
  const hasLegacySubscriptionRule = campaign.eligibilityRules.some((rule) => (
    rule.source === "subscription_purchase" && !rule.subscriptionGroupId
  ));
  setHint(refs.shakeCampaignResult, hasLegacySubscriptionRule
    ? "当前活动仍在使用旧版套餐金额规则。请添加订阅分组发卡规则后再发布新配置。"
    : "");
  const fallbackBalanceRule = campaign.eligibilityRules.find((rule) => (
    rule.source === "balance_consumption" && !rule.subscriptionGroupId
  ));
  refs.shakeBalanceThreshold.value = fallbackBalanceRule?.threshold || "";
  refs.shakeBalanceTier.value = fallbackBalanceRule?.cardTier || "low";
  renderShakePrizeEditor(campaign.prizes);
  refs.shakeCampaignFormTitle.textContent = `更新配置：${campaign.name}`;
  refs.shakeCampaignSubmitBtn.textContent = "发布新配置版本";
  refs.shakeCampaignResetBtn.classList.remove("hidden");
  refs.shakeCampaignForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveShakeCampaign() {
  try {
    const config = collectShakeConfig();
    const editId = refs.shakeCampaignEditId.value;
    const path = editId
      ? `/api/admin/sub2api/shake/campaigns/${encodeURIComponent(editId)}/config`
      : "/api/admin/sub2api/shake/campaigns";
    const body = editId ? config : {
      ...config,
      connectionId: refs.shakeCampaignConnection.value,
      name: refs.shakeCampaignName.value.trim(),
      startAt: new Date(refs.shakeCampaignStart.value).toISOString(),
      endAt: new Date(refs.shakeCampaignEnd.value).toISOString()
    };
    setHint(refs.shakeCampaignResult, editId ? "正在发布配置..." : "正在创建活动...");
    await api(path, { method: "POST", body: JSON.stringify(body) });
    setHint(refs.shakeCampaignResult, editId ? "新配置版本已生效" : "活动已创建，启用后对用户开放");
    resetShakeCampaignForm();
    await refreshShakeCampaigns();
  } catch (error) {
    setHint(refs.shakeCampaignResult, `保存失败：${error.message}`);
  }
}

function renderShakeCampaigns() {
  if (!refs.shakeCampaignList) return;
  renderTable(refs.shakeCampaignList, [
    { label: "活动", render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><code>${escapeHtml(item.id)}</code>` },
    { label: "状态", render: (item) => `${renderStatus(item.status)}<br/><span class="hint">配置 v${item.configVersion}</span>` },
    { label: "时间", render: (item) => `<span class="hint">${escapeHtml(formatWorldCupTime(item.startAt))}<br/>${escapeHtml(formatWorldCupTime(item.endAt))}</span>` },
    { label: "获取条件", render: (item) => item.eligibilityRules.map((rule) => {
      if (rule.source === "subscription_purchase" && rule.subscriptionGroupId) {
        return `订阅分组 ${escapeHtml(rule.subscriptionGroupId)}：${escapeHtml(SHAKE_CARD_TIER_LABELS[rule.cardTier] || rule.cardTier)} × ${escapeHtml(rule.cardQuantity)}`;
      }
      if (rule.source === "balance_consumption" && rule.subscriptionGroupId) {
        return `订阅分组 ${escapeHtml(rule.subscriptionGroupId)} 实际消耗：${escapeHtml(rule.threshold)} → ${escapeHtml(SHAKE_CARD_TIER_LABELS[rule.cardTier] || rule.cardTier)}`;
      }
      return `${escapeHtml(SHAKE_SOURCE_LABELS[rule.source] || rule.source)}：${escapeHtml(rule.threshold)} → ${escapeHtml(SHAKE_CARD_TIER_LABELS[rule.cardTier] || rule.cardTier)}`;
    }).join("<br/>") },
    { label: "奖池", render: (item) => item.prizes.map((prize) => `${escapeHtml(prize.name)} <span class="hint">低 ${escapeHtml(prize.probabilities.low)}% · 中 ${escapeHtml(prize.probabilities.medium)}% · 高 ${escapeHtml(prize.probabilities.high)}%</span>`).join("<br/>") },
    { label: "卡片", render: (item) => Object.entries(SHAKE_CARD_TIER_LABELS).map(([tier, label]) => {
      const totals = item.cardTotalsByTier?.[tier] || { available: 0, consumed: 0 };
      return `${escapeHtml(label)}：可用 ${escapeHtml(totals.available)} <span class="hint">· 已用 ${escapeHtml(totals.consumed)}</span>`;
    }).join("<br/>") },
    { label: "操作", render: (item) => `
      ${item.status !== "ended" ? `<button class="ghost-btn small" type="button" onclick="editShakeCampaign('${escapeHtml(item.id)}')">配置</button>` : ""}
      ${["draft", "scheduled"].includes(item.status) ? `<button class="primary-btn small" type="button" onclick="activateShakeCampaign('${escapeHtml(item.id)}')">启用</button>` : ""}
      ${item.status !== "ended" ? `<button class="ghost-btn small" type="button" style="color:var(--error)" onclick="endShakeCampaign('${escapeHtml(item.id)}')">结束</button>` : ""}
    ` }
  ], shakeCampaignsCache, "暂无摇摇乐活动");
}

async function refreshShakeCampaigns() {
  const params = new URLSearchParams();
  if (refs.shakeCampaignFilter?.value) params.set("connectionId", refs.shakeCampaignFilter.value);
  const payload = await api(`/api/admin/sub2api/shake/campaigns${params.size ? `?${params}` : ""}`);
  shakeCampaignsCache = payload.items || [];
  renderShakeCampaigns();
  if (refs.shakeGrantCampaign) {
    const current = refs.shakeGrantCampaign.value;
    refs.shakeGrantCampaign.innerHTML = `<option value="">选择活动</option>${shakeCampaignsCache.filter((item) => item.status !== "ended").map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}`;
    if (shakeCampaignsCache.some((item) => item.id === current)) refs.shakeGrantCampaign.value = current;
  }
  updateShakeEmbedUrl();
}

async function activateShakeCampaign(id) {
  if (!window.confirm("确认启用该活动？同一连接只能有一个进行中的活动。")) return;
  try {
    await api(`/api/admin/sub2api/shake/campaigns/${encodeURIComponent(id)}/activate`, { method: "POST", body: "{}" });
    setHint(refs.shakeCampaignResult, "活动已启用");
    await refreshShakeCampaigns();
  } catch (error) {
    setHint(refs.shakeCampaignResult, `启用失败：${error.message}`);
  }
}

async function endShakeCampaign(id) {
  const reason = window.prompt("请输入结束原因。未使用的摇摇卡会立即过期：");
  if (!reason) return;
  try {
    const payload = await api(`/api/admin/sub2api/shake/campaigns/${encodeURIComponent(id)}/end`, {
      method: "POST", body: JSON.stringify({ reason })
    });
    setHint(refs.shakeCampaignResult, `活动已结束，${payload.expiredCards} 张未使用摇摇卡已过期`);
    await refreshShakeCampaigns();
  } catch (error) {
    setHint(refs.shakeCampaignResult, `结束失败：${error.message}`);
  }
}

async function syncShakeUsage() {
  const connectionId = refs.shakeSyncConnection.value;
  if (!connectionId) return setHint(refs.shakeSyncResult, "请选择 Sub2api 连接");
  setButtonBusy(refs.shakeSyncUsageBtn, true, "同步中...");
  try {
    const result = await api(`/api/admin/sub2api/shake/connections/${encodeURIComponent(connectionId)}/sync-usage`, { method: "POST", body: "{}" });
    setHint(refs.shakeSyncResult, `导入 ${result.imported} 条实际消耗，新增 ${result.cardsGranted} 张摇摇卡`);
    await refreshShakeCampaigns();
  } catch (error) {
    setHint(refs.shakeSyncResult, `同步失败：${error.message}`);
  } finally {
    setButtonBusy(refs.shakeSyncUsageBtn, false);
  }
}

async function grantShakeCards() {
  try {
    const payload = await api("/api/admin/sub2api/shake/cards/grant", {
      method: "POST",
      body: JSON.stringify({
        campaignId: refs.shakeGrantCampaign.value,
        userId: refs.shakeGrantUser.value.trim(),
        email: refs.shakeGrantEmail.value.trim() || undefined,
        cardTier: refs.shakeGrantTier.value,
        quantity: Number(refs.shakeGrantQuantity.value),
        reason: refs.shakeGrantReason.value.trim()
      })
    });
    setHint(refs.shakeGrantResult, `已补发 ${payload.granted} 张${SHAKE_CARD_TIER_LABELS[payload.cardTier] || "抽奖卡"}`);
    refs.shakeManualGrantForm.reset();
    refs.shakeGrantQuantity.value = "1";
    await refreshShakeCampaigns();
  } catch (error) {
    setHint(refs.shakeGrantResult, `补发失败：${error.message}`);
  }
}

async function refreshShakeDraws() {
  if (!refs.shakeDrawList) return;
  const params = new URLSearchParams();
  if (refs.shakeDrawStatusFilter.value) params.set("status", refs.shakeDrawStatusFilter.value);
  if (refs.shakeDrawUserFilter.value.trim()) params.set("userId", refs.shakeDrawUserFilter.value.trim());
  const payload = await api(`/api/admin/sub2api/shake/draws?${params}`);
  renderTable(refs.shakeDrawList, [
    { label: "时间", render: (item) => escapeHtml(formatWorldCupTime(item.createdAt)) },
    { label: "用户", render: (item) => `<code>${escapeHtml(item.userId)}</code>${item.email ? `<br/><span class="hint">${escapeHtml(item.email)}</span>` : ""}` },
    { label: "奖品", render: (item) => `<strong>${escapeHtml(item.prize.name)}</strong><br/><span class="hint">${escapeHtml(SHAKE_CARD_TIER_LABELS[item.cardTier] || item.cardTier)} · ${escapeHtml(SHAKE_RARITY_LABELS[item.prize.rarity] || item.prize.rarity)}</span>` },
    { label: "状态", render: (item) => `${renderStatus(item.status)}${item.errorMessage ? `<br/><span class="hint">${escapeHtml(item.errorMessage)}</span>` : ""}` },
    { label: "操作", render: (item) => item.status === "delivery_failed" ? `
      <button class="primary-btn small" type="button" onclick="dispositionShakeDraw('${escapeHtml(item.id)}','retry')">重试</button>
      <button class="ghost-btn small" type="button" onclick="dispositionShakeDraw('${escapeHtml(item.id)}','confirm')">确认到账</button>
      <button class="ghost-btn small" type="button" style="color:var(--error)" onclick="dispositionShakeDraw('${escapeHtml(item.id)}','void')">作废</button>
    ` : escapeHtml(item.dispositionReason || "-") }
  ], payload.items || [], "暂无抽奖记录");
}

async function dispositionShakeDraw(id, action) {
  const label = { retry: "重试发放", confirm: "确认到账", void: "作废" }[action];
  const reason = window.prompt(`请输入“${label}”的处置原因：`);
  if (!reason) return;
  try {
    const payload = await api(`/api/admin/sub2api/shake/draws/${encodeURIComponent(id)}/disposition`, {
      method: "POST", body: JSON.stringify({ action, reason })
    });
    setHint(refs.shakeDrawResult, `${label}完成，当前状态：${getStatusLabel(payload.draw.status)}`);
    await Promise.all([refreshShakeDraws(), refreshShakeCampaigns()]);
  } catch (error) {
    setHint(refs.shakeDrawResult, `${label}失败：${error.message}`);
  }
}

async function refreshShakeConsole() {
  if (!sub2apiConnectionsCache.length) await refreshSub2ApiConnections();
  await Promise.all([refreshShakeCampaigns(), refreshShakeDraws()]);
}

window.editShakeCampaign = editShakeCampaign;
window.activateShakeCampaign = activateShakeCampaign;
window.endShakeCampaign = endShakeCampaign;
window.dispositionShakeDraw = dispositionShakeDraw;

function resetSub2ApiConnectionForm() {
  if (!refs.sub2apiConnectionForm) return;
  refs.sub2apiConnectionForm.reset();
  refs.sub2apiConnectionEditId.value = "";
  refs.sub2apiConnectionStatus.value = "active";
  refs.sub2apiConnectionFormTitle.textContent = "添加远程连接";
  refs.sub2apiConnectionSubmitBtn.textContent = "保存连接";
  refs.sub2apiConnectionCancelBtn.classList.add("hidden");
  refs.sub2apiConnectionAdminToken.placeholder = "创建时必填；编辑时留空则保持不变";
}

function populateSub2ApiConnectionFilter() {
  const filterOptions = [`<option value="">全部连接</option>`]
    .concat(sub2apiConnectionsCache.map((item) => `
      <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}（${escapeHtml(getStatusLabel(item.status))}）</option>
    `))
    .join("");
  const formOptions = [`<option value="">选择连接</option>`]
    .concat(sub2apiConnectionsCache.map((item) => `
      <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}（${escapeHtml(getStatusLabel(item.status))}）</option>
    `))
    .join("");

  for (const select of [
    refs.sub2apiInviteConnectionFilter,
    refs.worldCupMatchConnectionFilter,
    refs.worldCupBetConnectionFilter
  ]) {
    if (!select) continue;
    const current = select.value;
    select.innerHTML = filterOptions;
    if (sub2apiConnectionsCache.some((item) => item.id === current)) {
      select.value = current;
    }
  }

  if (refs.worldCupMatchConnection) {
    const current = refs.worldCupMatchConnection.value;
    refs.worldCupMatchConnection.innerHTML = formOptions;
    if (sub2apiConnectionsCache.some((item) => item.id === current)) {
      refs.worldCupMatchConnection.value = current;
    } else if (sub2apiConnectionsCache.length === 1) {
      refs.worldCupMatchConnection.value = sub2apiConnectionsCache[0].id;
    }
  }

  if (refs.sub2apiOrderConnectionFilter) {
    const currentOrder = refs.sub2apiOrderConnectionFilter.value;
    refs.sub2apiOrderConnectionFilter.innerHTML = [`<option value="">全部连接</option>`]
      .concat(sub2apiConnectionsCache.map((item) => `
        <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}（${escapeHtml(getStatusLabel(item.status))}）</option>
      `))
      .join("");
    if (sub2apiConnectionsCache.some((item) => item.id === currentOrder)) {
      refs.sub2apiOrderConnectionFilter.value = currentOrder;
    }
  }

  if (refs.sub2apiPlanConnection) {
    const currentPlan = refs.sub2apiPlanConnection.value;
    refs.sub2apiPlanConnection.innerHTML = [`<option value="">选择连接</option>`]
      .concat(sub2apiConnectionsCache.map((item) => `
        <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}（${escapeHtml(getStatusLabel(item.status))}）</option>
      `))
      .join("");
    if (sub2apiConnectionsCache.some((item) => item.id === currentPlan)) {
      refs.sub2apiPlanConnection.value = currentPlan;
    } else if (!refs.sub2apiPlanConnection.value && sub2apiConnectionsCache.length) {
      refs.sub2apiPlanConnection.value = sub2apiConnectionsCache[0].id;
    }
  }

  if (refs.sub2apiUpstreamMonitorConnection) {
    const currentMonitor = refs.sub2apiUpstreamMonitorConnection.value;
    refs.sub2apiUpstreamMonitorConnection.innerHTML = [`<option value="">选择连接</option>`]
      .concat(sub2apiConnectionsCache.map((item) => `
        <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}（${escapeHtml(getStatusLabel(item.status))}）</option>
      `))
      .join("");
    if (sub2apiConnectionsCache.some((item) => item.id === currentMonitor)) {
      refs.sub2apiUpstreamMonitorConnection.value = currentMonitor;
    } else if (sub2apiConnectionsCache.length) {
      refs.sub2apiUpstreamMonitorConnection.value = sub2apiConnectionsCache[0].id;
    }
  }

  if (refs.sub2apiModelRouteConnection) {
    const currentRoute = refs.sub2apiModelRouteConnection.value;
    refs.sub2apiModelRouteConnection.innerHTML = [`<option value="">选择连接</option>`]
      .concat(sub2apiConnectionsCache.map((item) => `
        <option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}（${escapeHtml(getStatusLabel(item.status))}）</option>
      `))
      .join("");
    if (sub2apiConnectionsCache.some((item) => item.id === currentRoute)) {
      refs.sub2apiModelRouteConnection.value = currentRoute;
    } else if (sub2apiConnectionsCache.length) {
      refs.sub2apiModelRouteConnection.value = sub2apiConnectionsCache[0].id;
    }
  }

  for (const select of [refs.shakeCampaignConnection, refs.shakeSyncConnection]) {
    if (!select) continue;
    const current = select.value;
    select.innerHTML = formOptions;
    if (sub2apiConnectionsCache.some((item) => item.id === current)) {
      select.value = current;
    } else if (sub2apiConnectionsCache.length === 1) {
      select.value = sub2apiConnectionsCache[0].id;
    }
  }
  if (refs.shakeCampaignFilter) {
    const current = refs.shakeCampaignFilter.value;
    refs.shakeCampaignFilter.innerHTML = filterOptions;
    if (sub2apiConnectionsCache.some((item) => item.id === current)) refs.shakeCampaignFilter.value = current;
  }
  updateShakeEmbedUrl();
}

async function refreshSub2ApiConnections() {
  if (!refs.sub2apiConnectionList) return;
  const payload = await api("/api/admin/sub2api/connections");
  sub2apiConnectionsCache = payload.items || [];
  populateSub2ApiConnectionFilter();

  renderTable(refs.sub2apiConnectionList, [
    {
      label: "连接",
      render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><code>${escapeHtml(item.id)}</code>`
    },
    {
      label: "基础地址",
      render: (item) => `<code style="font-size:12px;word-break:break-all">${escapeHtml(item.baseUrl)}</code>`
    },
    {
      label: "管理令牌",
      render: (item) => item.hasAdminToken ? "已保存" : "未配置"
    },
    {
      label: "状态",
      render: (item) => renderStatus(item.status)
    },
    {
      label: "最近测试",
      render: (item) => `
        <div style="font-size:12px;line-height:1.5">
          <div>${escapeHtml(item.lastTestAt || "未测试")}</div>
          <div style="color:${item.lastTestStatus === "failed" ? "var(--error)" : "var(--muted)"}">${escapeHtml(getStatusLabel(item.lastTestStatus))}${item.lastTestError ? ` · ${escapeHtml(item.lastTestError)}` : ""}</div>
        </div>
      `
    },
    {
      label: "操作",
      render: (item) => `
        <button class="primary-btn small" type="button" onclick="editSub2ApiConnection('${escapeHtml(item.id)}')">编辑</button>
        <button class="ghost-btn small" type="button" onclick="testSub2ApiConnection('${escapeHtml(item.id)}')">测试</button>
        <button class="ghost-btn small" type="button" style="color:var(--error)" onclick="deleteSub2ApiConnection('${escapeHtml(item.id)}')">删除</button>
      `
    }
  ], sub2apiConnectionsCache, "暂无 Sub2api 连接");
}

async function refreshSub2ApiUpstreamMonitors() {
  if (!refs.sub2apiUpstreamMonitorList) return;
  const connectionId = refs.sub2apiUpstreamMonitorConnection?.value || sub2apiConnectionsCache[0]?.id || "";
  if (!connectionId) {
    refs.sub2apiUpstreamMonitorList.innerHTML = `<p class="hint centered">请先添加 Sub2api 连接</p>`;
    return;
  }
  const payload = await api(`/api/admin/sub2api/connections/${encodeURIComponent(connectionId)}/upstream-monitors`);
  renderTable(refs.sub2apiUpstreamMonitorList, [
    { label: "名称", render: (item) => `<strong>${escapeHtml(item.name || "-")}</strong><br/><span class="hint">${escapeHtml(SUB2API_MONITOR_PROVIDER_LABELS[item.provider] || item.provider || "-")}</span>` },
    { label: "模型", render: (item) => escapeHtml(item.primaryModel || "-") },
    { label: "状态", render: (item) => renderStatus(item.primaryStatus || "unknown", SUB2API_MONITOR_STATUS_LABELS) },
    { label: "延迟", render: (item) => item.primaryLatencyMs === null || item.primaryLatencyMs === undefined ? "-" : `${escapeHtml(item.primaryLatencyMs)} 毫秒` },
    { label: "七日可用率", render: (item) => item.availability7d === null || item.availability7d === undefined ? "-" : `${Number(item.availability7d).toFixed(2)}%` },
    { label: "启用", render: (item) => item.enabled ? "是" : "否" },
    { label: "最近检测", render: (item) => escapeHtml(item.lastCheckedAt || "-") }
  ], payload.items || [], "远程 Sub2api 暂无监控数据");
  setHint(refs.sub2apiUpstreamMonitorResult, `已读取上游监控：${payload.total ?? payload.items?.length ?? 0} 条`);
}

function renderModelRouteChain(item) {
  const source = escapeHtml(item.sourceModel || "-");
  const target = escapeHtml(item.mappedModel || "-");
  return item.mapped ? `<code>${source}</code> → <code>${target}</code>` : `<code>${source}</code>`;
}

async function refreshSub2ApiModelRoutes({ force = false } = {}) {
  if (!refs.sub2apiModelRouteList) return;
  const connectionId = refs.sub2apiModelRouteConnection?.value || sub2apiConnectionsCache[0]?.id || "";
  if (!connectionId) {
    refs.sub2apiModelRouteList.innerHTML = `<p class="hint centered">请先添加 Sub2api 连接</p>`;
    setHint(refs.sub2apiModelRouteSummary, "");
    return;
  }

  if (force || !sub2apiModelRoutesCache || sub2apiModelRoutesCache.connectionId !== connectionId) {
    sub2apiModelRoutesCache = {
      connectionId,
      payload: await api(`/api/admin/sub2api/connections/${encodeURIComponent(connectionId)}/model-routes`)
    };
  }
  const payload = sub2apiModelRoutesCache.payload;
  const keyword = String(refs.sub2apiModelRouteFilter?.value || "").trim().toLowerCase();
  const routes = (payload.routes || []).filter((item) => {
    if (!keyword) return true;
    return [
      item.platform,
      item.groupName,
      item.channelName,
      item.sourceModel,
      item.mappedModel,
      item.billingModelSource
    ].some((value) => String(value || "").toLowerCase().includes(keyword));
  });

  if (refs.sub2apiModelRouteSummary) {
    const models = payload.models || [];
    refs.sub2apiModelRouteSummary.innerHTML = `
      <div>模型 ${models.length} 个，路由 ${payload.routes?.length || 0} 条，分组 ${payload.groups?.length || 0} 个，渠道 ${payload.channels?.length || 0} 个。</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        ${models.slice(0, 80).map((model) => `<span class="table-badge">${escapeHtml(model)}</span>`).join("")}
        ${models.length > 80 ? `<span class="hint">另有 ${models.length - 80} 个</span>` : ""}
      </div>
    `;
  }
  renderTable(refs.sub2apiModelRouteList, [
    { label: "平台", render: (item) => escapeHtml(item.platform || "-") },
    { label: "分组", render: (item) => `<strong>${escapeHtml(item.groupName || "-")}</strong><br/><span class="hint">${escapeHtml(getStatusLabel(item.groupStatus))}</span>` },
    { label: "渠道", render: (item) => `<strong>${escapeHtml(item.channelName || "-")}</strong><br/><span class="hint">${escapeHtml(getStatusLabel(item.channelStatus))}</span>` },
    { label: "模型路由", render: renderModelRouteChain },
    { label: "计费来源", render: (item) => escapeHtml(item.billingModelSource || "-") },
    { label: "限制模型", render: (item) => item.restrictModels ? "是" : "否" }
  ], routes, "暂无模型路由数据");
  setHint(refs.sub2apiModelRouteResult, keyword ? `筛选命中 ${routes.length} 条` : `已读取 ${routes.length} 条模型路由`);
}

function editSub2ApiConnection(id) {
  const item = sub2apiConnectionsCache.find((entry) => entry.id === id);
  if (!item || !refs.sub2apiConnectionForm) return;
  refs.sub2apiConnectionEditId.value = item.id;
  refs.sub2apiConnectionName.value = item.name || "";
  refs.sub2apiConnectionBaseUrl.value = item.baseUrl || "";
  refs.sub2apiConnectionAdminToken.value = "";
  refs.sub2apiConnectionAdminToken.placeholder = "留空则保持原 Admin Token";
  refs.sub2apiConnectionStatus.value = item.status || "active";
  refs.sub2apiConnectionFormTitle.textContent = `编辑连接：${item.name}`;
  refs.sub2apiConnectionSubmitBtn.textContent = "保存修改";
  refs.sub2apiConnectionCancelBtn.classList.remove("hidden");
  refs.sub2apiConnectionForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function testSub2ApiConnection(id) {
  try {
    setHint(refs.sub2apiConnectionResult, "正在测试连接...");
    await api(`/api/admin/sub2api/connections/${encodeURIComponent(id)}/test`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.sub2apiConnectionResult, "测试成功");
    await refreshSub2ApiConnections();
  } catch (error) {
    setHint(refs.sub2apiConnectionResult, `测试失败：${error.message}`);
    await refreshSub2ApiConnections().catch(() => {});
  }
}

async function deleteSub2ApiConnection(id) {
  if (!window.confirm("确认删除该 Sub2api 连接？历史邀请码记录会保留。")) return;
  try {
    await api(`/api/admin/sub2api/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({})
    });
    if (refs.sub2apiConnectionEditId?.value === id) resetSub2ApiConnectionForm();
    setHint(refs.sub2apiConnectionResult, "连接已删除");
    await refreshSub2ApiConsole();
  } catch (error) {
    setHint(refs.sub2apiConnectionResult, `删除失败：${error.message}`);
  }
}

async function saveSub2ApiConnection() {
  const id = refs.sub2apiConnectionEditId?.value || "";
  const payload = {
    name: refs.sub2apiConnectionName.value.trim(),
    baseUrl: refs.sub2apiConnectionBaseUrl.value.trim(),
    status: refs.sub2apiConnectionStatus.value
  };
  const adminToken = refs.sub2apiConnectionAdminToken.value.trim();
  if (adminToken) payload.adminToken = adminToken;
  if (!id && !adminToken) {
    setHint(refs.sub2apiConnectionResult, "新建连接必须填写 Admin Token");
    return;
  }

  try {
    setHint(refs.sub2apiConnectionResult, "正在保存...");
    await api(id ? `/api/admin/sub2api/connections/${encodeURIComponent(id)}` : "/api/admin/sub2api/connections", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    setHint(refs.sub2apiConnectionResult, "连接已保存");
    resetSub2ApiConnectionForm();
    await refreshSub2ApiConsole();
  } catch (error) {
    setHint(refs.sub2apiConnectionResult, `保存失败：${error.message}`);
  }
}

function getSelectedSub2ApiInviteCodes() {
  const checked = Array.from(document.querySelectorAll(".sub2api-invite-check:checked"));
  const source = checked.length
    ? checked
    : Array.from(document.querySelectorAll(".sub2api-invite-check"));
  return source
    .map((item) => item.dataset.inviteCode || "")
    .filter(Boolean);
}

async function refreshSub2ApiInvites() {
  if (!refs.sub2apiInviteList) return;
  const state = getTableState(refs.sub2apiInviteList);
  const params = new URLSearchParams();
  if (refs.sub2apiInviteConnectionFilter?.value) params.set("connectionId", refs.sub2apiInviteConnectionFilter.value);
  if (refs.sub2apiInviteUserFilter?.value.trim()) params.set("userId", refs.sub2apiInviteUserFilter.value.trim());
  if (refs.sub2apiInviteStatusFilter?.value) params.set("status", refs.sub2apiInviteStatusFilter.value);
  params.set("page", String(state.page || 1));
  params.set("pageSize", String(state.pageSize || DEFAULT_TABLE_PAGE_SIZE));

  const payload = await api(`/api/admin/sub2api/invites?${params.toString()}`);
  sub2apiInvitesCache = payload.items || [];
  renderTable(refs.sub2apiInviteList, [
    {
      label: "",
      render: (item) => `<input type="checkbox" class="sub2api-invite-check" value="${escapeHtml(item.id)}" data-invite-code="${escapeHtml(item.inviteCode || "")}" />`
    },
    {
      label: "邀请码",
      render: (item) => item.inviteCode ? `<code>${escapeHtml(item.inviteCode)}</code>` : "-"
    },
    {
      label: "连接",
      render: (item) => `${escapeHtml(item.connectionName || "-")}<br/><code style="font-size:11px">${escapeHtml(item.connectionId)}</code>`
    },
    {
      label: "账号",
      render: (item) => `
        <div style="font-size:12px;line-height:1.5">
          <div><code>${escapeHtml(item.userId)}</code></div>
          <div>${escapeHtml(item.email || item.username || "-")}</div>
        </div>
      `
    },
    {
      label: "状态",
      render: (item) => renderStatus(item.status)
    },
    {
      label: "远端 ID",
      render: (item) => item.remoteInviteId ? `<code>${escapeHtml(item.remoteInviteId)}</code>` : "-"
    },
    {
      label: "时间",
      render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt || "-")}</span>`
    },
    {
      label: "错误",
      render: (item) => item.errorMessage ? `<span style="color:var(--error)" title="${escapeHtml(item.errorMessage)}">${escapeHtml(item.errorMessage.slice(0, 36))}</span>` : "-"
    }
  ], sub2apiInvitesCache, "暂无邀请码记录", {
    server: true,
    total: Number(payload.total ?? sub2apiInvitesCache.length),
    page: Number(payload.page ?? state.page),
    pageSize: Number(payload.pageSize ?? state.pageSize),
    onPageChange: () => refreshSub2ApiInvites().catch((error) => {
      refs.sub2apiInviteList.innerHTML = `<p class="hint centered">加载邀请码失败：${escapeHtml(error.message)}</p>`;
    })
  });
  setHint(refs.sub2apiInviteResult, `共 ${payload.total ?? sub2apiInvitesCache.length} 条记录，当前显示 ${sub2apiInvitesCache.length} 条`);
}

async function syncSub2ApiInvites() {
  const body = {};
  if (refs.sub2apiInviteConnectionFilter?.value) body.connectionId = refs.sub2apiInviteConnectionFilter.value;
  const payload = await api("/api/admin/sub2api/invites/sync", {
    method: "POST",
    body: JSON.stringify(body)
  });
  const message = `同步完成：同步 ${payload.connections || 1} 个连接，更新邀请码 ${payload.updated || 0} 条，生成返利 ${payload.rebatesCreated || 0} 条`;
  setHint(refs.sub2apiInviteResult, message);
  setHint(refs.sub2apiRebateResult, message);
  await refreshSub2ApiInvites();
  await refreshSub2ApiRebates().catch(() => {});
}

async function loadSub2ApiInviterLevels() {
  if (!refs.sub2apiLevelList) return;
  const payload = await api("/api/admin/sub2api/inviter-levels");
  sub2apiLevelsCache = (payload.levels || []).map((level) => ({
    id: level.id,
    name: level.name,
    spendThreshold: level.spendThreshold,
    lifetimeInviteLimit: level.lifetimeInviteLimit,
    unusedInviteLimit: level.unusedInviteLimit,
    rebateRate: level.rebateRate,
    sortOrder: level.sortOrder,
    status: level.status === "disabled" ? "disabled" : "active"
  }));
  renderSub2ApiInviterLevels();
  setHint(refs.sub2apiLevelResult, `已读取 ${sub2apiLevelsCache.length} 个等级`);
}

function renderSub2ApiInviterLevels() {
  if (!refs.sub2apiLevelList) return;
  if (!sub2apiLevelsCache.length) {
    refs.sub2apiLevelList.innerHTML = `<p class="hint centered">暂无等级，点击“推荐配置”或“新增等级”开始配置。</p>`;
    return;
  }
  refs.sub2apiLevelList.innerHTML = `
    <table class="sub2api-level-table">
      <thead>
        <tr>
          <th>等级名称</th>
          <th>累计充值金额</th>
          <th>终身可申请</th>
          <th>未使用上限</th>
          <th>返利比例</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${sub2apiLevelsCache.map((level, index) => `
          <tr data-level-index="${index}" data-level-id="${escapeHtml(level.id || "")}">
            <td><input class="small-input sub2api-level-name" value="${escapeHtml(level.name || "")}" placeholder="默认" /></td>
            <td><input class="small-input sub2api-level-spend" type="number" min="0" step="0.0001" value="${escapeHtml(level.spendThreshold ?? 0)}" /></td>
            <td><input class="small-input sub2api-level-lifetime" type="number" min="0" step="1" value="${escapeHtml(level.lifetimeInviteLimit ?? 0)}" /></td>
            <td><input class="small-input sub2api-level-unused" type="number" min="0" step="1" value="${escapeHtml(level.unusedInviteLimit ?? 0)}" /></td>
            <td><input class="small-input sub2api-level-rebate" type="number" min="0" max="100" step="0.01" value="${escapeHtml(level.rebateRate ?? 0)}" /></td>
            <td>
              <select class="small-select sub2api-level-status">
                <option value="active"${level.status === "disabled" ? "" : " selected"}>启用</option>
                <option value="disabled"${level.status === "disabled" ? " selected" : ""}>禁用</option>
              </select>
            </td>
            <td><button class="ghost-btn tiny sub2api-level-remove" type="button">删除</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function collectSub2ApiInviterLevels() {
  const rows = Array.from(refs.sub2apiLevelList.querySelectorAll("tr[data-level-index]"));
  return rows.map((row, index) => ({
    id: row.dataset.levelId || "",
    name: row.querySelector(".sub2api-level-name").value.trim(),
    spendThreshold: Number(row.querySelector(".sub2api-level-spend").value || 0),
    lifetimeInviteLimit: Number(row.querySelector(".sub2api-level-lifetime").value || 0),
    unusedInviteLimit: Number(row.querySelector(".sub2api-level-unused").value || 0),
    rebateRate: Number(row.querySelector(".sub2api-level-rebate").value || 0),
    sortOrder: index * 10,
    status: row.querySelector(".sub2api-level-status").value
  }));
}

function addSub2ApiInviterLevel(level = {}) {
  const nextIndex = sub2apiLevelsCache.length;
  sub2apiLevelsCache.push({
    id: level.id || "",
    name: level.name || `等级 ${nextIndex + 1}`,
    spendThreshold: level.spendThreshold ?? 0,
    lifetimeInviteLimit: level.lifetimeInviteLimit ?? 3,
    unusedInviteLimit: level.unusedInviteLimit ?? 2,
    rebateRate: level.rebateRate ?? 5,
    sortOrder: level.sortOrder ?? nextIndex * 10,
    status: level.status || "active"
  });
  renderSub2ApiInviterLevels();
}

async function saveSub2ApiInviterLevels() {
  const levels = collectSub2ApiInviterLevels();
  if (!levels.length) throw new Error("至少保留一个等级");
  if (levels.some((level) => !level.name)) throw new Error("等级名称不能为空");
  const payload = await api("/api/admin/sub2api/inviter-levels", {
    method: "PUT",
    body: JSON.stringify({ levels })
  });
  sub2apiLevelsCache = payload.levels || levels;
  renderSub2ApiInviterLevels();
  await refreshSub2ApiRebates();
  setHint(refs.sub2apiLevelResult, `保存成功，已处理 ${payload.recalculation?.users || 0} 个已知用户，同步成功 ${payload.recalculation?.synced || 0} 个，重算返利 ${payload.recalculation?.rebates?.updated || 0} 条`);
}

async function refreshSub2ApiRebates() {
  if (!refs.sub2apiRebateList) return;
  const state = getTableState(refs.sub2apiRebateList);
  const params = new URLSearchParams();
  if (refs.sub2apiRebateStatusFilter?.value) params.set("status", refs.sub2apiRebateStatusFilter.value);
  params.set("page", String(state.page || 1));
  params.set("pageSize", String(state.pageSize || DEFAULT_TABLE_PAGE_SIZE));
  const payload = await api(`/api/admin/sub2api/invite-rebates?${params.toString()}`);
  sub2apiRebatesCache = payload.items || [];
  renderTable(refs.sub2apiRebateList, [
    { label: "邀请人", render: (item) => `<code>${escapeHtml(item.inviterUserId || "-")}</code>` },
    { label: "被邀请人", render: (item) => `${escapeHtml(item.inviteeDisplay || "-")}` },
    { label: "邀请码", render: (item) => `<code>${escapeHtml(item.inviteCode || "-")}</code>` },
    { label: "首次余额", render: (item) => `${escapeHtml(SUB2API_SOURCE_TYPE_LABELS[item.sourceType] || item.sourceType || "-")}<br/>${formatBalance(item.firstAmount)}` },
    { label: "返利", render: (item) => `${formatBalance(item.rebateAmount)}<br/><span class="muted">${escapeHtml(item.rebateRate)}%</span>` },
    { label: "状态", render: (item) => renderStatus(item.status, SUB2API_REBATE_STATUS_LABELS) },
    { label: "时间", render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt || "-")}</span>` },
    {
      label: "操作",
      render: (item) => `
        <div class="inline-actions">
          ${item.status === "pending" ? `<button class="ghost-btn tiny sub2api-rebate-action" data-id="${escapeHtml(item.id)}" data-action="approve">通过</button><button class="ghost-btn tiny sub2api-rebate-action" data-id="${escapeHtml(item.id)}" data-action="reject">驳回</button>` : ""}
          ${item.status === "approved" ? `<button class="ghost-btn tiny sub2api-rebate-action" data-id="${escapeHtml(item.id)}" data-action="revoke">撤销</button>` : ""}
        </div>
      `
    }
  ], sub2apiRebatesCache, "暂无返利记录", {
    server: true,
    total: Number(payload.total ?? sub2apiRebatesCache.length),
    page: Number(payload.page ?? state.page),
    pageSize: Number(payload.pageSize ?? state.pageSize),
    onPageChange: () => refreshSub2ApiRebates().catch((error) => {
      refs.sub2apiRebateList.innerHTML = `<p class="hint centered">加载返利失败：${escapeHtml(error.message)}</p>`;
    })
  });
  setHint(refs.sub2apiRebateResult, `共 ${payload.total ?? sub2apiRebatesCache.length} 条返利记录`);
}

async function runSub2ApiRebateAction(id, action) {
  const actionLabel = SUB2API_REBATE_ACTION_LABELS[action] || action;
  const reason = window.prompt("备注/原因", actionLabel) || "";
  const payload = await api(`/api/admin/sub2api/invite-rebates/${encodeURIComponent(id)}/${encodeURIComponent(action)}`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
  setHint(refs.sub2apiRebateResult, `操作成功：${getStatusLabel(payload.rebate?.status || action, SUB2API_REBATE_STATUS_LABELS)}`);
  await refreshSub2ApiRebates();
}

function resetSub2ApiPlanForm() {
  if (!refs.sub2apiPlanForm) return;
  refs.sub2apiPlanForm.reset();
  refs.sub2apiPlanEditId.value = "";
  refs.sub2apiPlanValidityDays.value = "30";
  refs.sub2apiPlanSortOrder.value = "0";
  refs.sub2apiPlanStatus.value = "active";
  refs.sub2apiPlanFormTitle.textContent = "添加订阅套餐";
  refs.sub2apiPlanSubmitBtn.textContent = "保存套餐";
  refs.sub2apiPlanCancelBtn.classList.add("hidden");
  populateSub2ApiConnectionFilter();
}

async function refreshSub2ApiPlans() {
  if (!refs.sub2apiPlanList) return;
  const payload = await api("/api/admin/sub2api/subscription-plans");
  sub2apiPlansCache = payload.items || [];
  renderTable(refs.sub2apiPlanList, [
    {
      label: "套餐",
      render: (item) => `<strong>${escapeHtml(item.name)}</strong><br/><span class="hint">${escapeHtml(item.description || "-")}</span>`
    },
    {
      label: "连接",
      render: (item) => `${escapeHtml(item.connectionName || "-")}<br/><code style="font-size:11px">${escapeHtml(item.connectionId)}</code>`
    },
    {
      label: "金额/天数",
      render: (item) => `<strong>${escapeHtml(formatCurrency(item.price))}</strong><br/><span class="hint">${escapeHtml(item.validityDays)} 天</span>`
    },
    {
      label: "分组",
      render: (item) => `
        <div style="font-size:12px;line-height:1.5">
          <div>订阅：<code>${escapeHtml(item.subscriptionGroupId)}</code></div>
          <div>原专属：${item.sourceDedicatedGroupId ? `<code>${escapeHtml(item.sourceDedicatedGroupId)}</code>` : "-"}</div>
          <div>新专属：${item.dedicatedGroupId ? `<code>${escapeHtml(item.dedicatedGroupId)}</code>` : "-"}</div>
        </div>
      `
    },
    {
      label: "状态",
      render: (item) => `${renderStatus(item.status)}<br/><span class="hint">排序 ${escapeHtml(item.sortOrder)}</span>`
    },
    {
      label: "操作",
      render: (item) => `
        <button class="primary-btn small" type="button" onclick="editSub2ApiPlan('${escapeHtml(item.id)}')">编辑</button>
        <button class="ghost-btn small" type="button" style="color:var(--error)" onclick="deleteSub2ApiPlan('${escapeHtml(item.id)}')">删除</button>
      `
    }
  ], sub2apiPlansCache, "暂无订阅套餐");
}

function editSub2ApiPlan(id) {
  const item = sub2apiPlansCache.find((entry) => entry.id === id);
  if (!item || !refs.sub2apiPlanForm) return;
  refs.sub2apiPlanEditId.value = item.id;
  refs.sub2apiPlanConnection.value = item.connectionId || "";
  refs.sub2apiPlanName.value = item.name || "";
  refs.sub2apiPlanPrice.value = item.price || "";
  refs.sub2apiPlanValidityDays.value = item.validityDays || 30;
  refs.sub2apiPlanSubscriptionGroupId.value = item.subscriptionGroupId || "";
  refs.sub2apiPlanSourceDedicatedGroupId.value = item.sourceDedicatedGroupId || "";
  refs.sub2apiPlanDedicatedGroupId.value = item.dedicatedGroupId || "";
  refs.sub2apiPlanSortOrder.value = item.sortOrder || 0;
  refs.sub2apiPlanStatus.value = item.status || "active";
  refs.sub2apiPlanDescription.value = item.description || "";
  refs.sub2apiPlanFormTitle.textContent = `编辑套餐：${item.name}`;
  refs.sub2apiPlanSubmitBtn.textContent = "保存修改";
  refs.sub2apiPlanCancelBtn.classList.remove("hidden");
  refs.sub2apiPlanForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveSub2ApiPlan() {
  const id = refs.sub2apiPlanEditId?.value || "";
  const payload = {
    connectionId: refs.sub2apiPlanConnection.value,
    name: refs.sub2apiPlanName.value.trim(),
    description: refs.sub2apiPlanDescription.value.trim(),
    price: Number(refs.sub2apiPlanPrice.value),
    validityDays: Number(refs.sub2apiPlanValidityDays.value),
    subscriptionGroupId: Number(refs.sub2apiPlanSubscriptionGroupId.value),
    sourceDedicatedGroupId: refs.sub2apiPlanSourceDedicatedGroupId.value ? Number(refs.sub2apiPlanSourceDedicatedGroupId.value) : null,
    dedicatedGroupId: refs.sub2apiPlanDedicatedGroupId.value ? Number(refs.sub2apiPlanDedicatedGroupId.value) : null,
    sortOrder: Number(refs.sub2apiPlanSortOrder.value || 0),
    status: refs.sub2apiPlanStatus.value
  };
  try {
    setHint(refs.sub2apiPlanResult, "正在保存...");
    await api(id ? `/api/admin/sub2api/subscription-plans/${encodeURIComponent(id)}` : "/api/admin/sub2api/subscription-plans", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    setHint(refs.sub2apiPlanResult, "套餐已保存");
    resetSub2ApiPlanForm();
    await refreshSub2ApiPlans();
  } catch (error) {
    setHint(refs.sub2apiPlanResult, `保存失败：${error.message}`);
  }
}

async function deleteSub2ApiPlan(id) {
  if (!window.confirm("确认删除该订阅套餐？历史订单会保留。")) return;
  try {
    await api(`/api/admin/sub2api/subscription-plans/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({})
    });
    if (refs.sub2apiPlanEditId?.value === id) resetSub2ApiPlanForm();
    setHint(refs.sub2apiPlanResult, "套餐已删除");
    await refreshSub2ApiPlans();
  } catch (error) {
    setHint(refs.sub2apiPlanResult, `删除失败：${error.message}`);
  }
}

async function refreshSub2ApiOrders() {
  if (!refs.sub2apiOrderList) return;
  const state = getTableState(refs.sub2apiOrderList);
  const params = new URLSearchParams();
  if (refs.sub2apiOrderConnectionFilter?.value) params.set("connectionId", refs.sub2apiOrderConnectionFilter.value);
  if (refs.sub2apiOrderUserFilter?.value.trim()) params.set("userId", refs.sub2apiOrderUserFilter.value.trim());
  if (refs.sub2apiOrderStatusFilter?.value) params.set("status", refs.sub2apiOrderStatusFilter.value);
  params.set("page", String(state.page || 1));
  params.set("pageSize", String(state.pageSize || DEFAULT_TABLE_PAGE_SIZE));
  const payload = await api(`/api/admin/sub2api/subscription-orders?${params.toString()}`);
  sub2apiOrdersCache = payload.items || [];
  renderTable(refs.sub2apiOrderList, [
    {
      label: "订单",
      render: (item) => `<code>${escapeHtml(item.id)}</code><br/><span class="hint">${escapeHtml(item.planName || item.planId)}</span>`
    },
    {
      label: "用户",
      render: (item) => `<code>${escapeHtml(item.userId)}</code><br/><span class="hint">${escapeHtml(item.email || item.username || "-")}</span>`
    },
    {
      label: "金额/天数",
      render: (item) => `<strong>${escapeHtml(formatCurrency(item.price))}</strong><br/><span class="hint">${escapeHtml(item.validityDays)} 天</span>`
    },
    {
      label: "分组",
      render: (item) => `订阅 <code>${escapeHtml(item.subscriptionGroupId)}</code><br/>原专属 ${item.sourceDedicatedGroupId ? `<code>${escapeHtml(item.sourceDedicatedGroupId)}</code>` : "-"}<br/>新专属 ${item.dedicatedGroupId ? `<code>${escapeHtml(item.dedicatedGroupId)}</code>` : "-"}`
    },
    {
      label: "状态",
      render: (item) => renderStatus(item.status)
    },
    {
      label: "时间",
      render: (item) => `<span style="font-size:12px">${escapeHtml(item.createdAt || "-")}</span>`
    },
    {
      label: "错误",
      render: (item) => item.errorMessage ? `<span style="color:var(--error)" title="${escapeHtml(item.errorMessage)}">${escapeHtml(item.errorMessage.slice(0, 42))}</span>` : "-"
    }
  ], sub2apiOrdersCache, "暂无订阅订单", {
    server: true,
    total: Number(payload.total ?? sub2apiOrdersCache.length),
    page: Number(payload.page ?? state.page),
    pageSize: Number(payload.pageSize ?? state.pageSize),
    onPageChange: () => refreshSub2ApiOrders().catch((error) => {
      refs.sub2apiOrderList.innerHTML = `<p class="hint centered">加载订阅订单失败：${escapeHtml(error.message)}</p>`;
    })
  });
  setHint(refs.sub2apiOrderResult, `共 ${payload.total ?? sub2apiOrdersCache.length} 条记录，当前显示 ${sub2apiOrdersCache.length} 条`);
}

function renderWorldCupApiUsage(payload) {
  if (!refs.worldCupApiUsage) return;
  const settings = payload?.settings || {};
  const usage = payload?.usage || {};
  const hasKey = settings.hasApiKey ? "Key 已配置" : "Key 未配置";
  const enabled = settings.enabled ? "启用" : "停用";
  const provider = getWorldCupProviderLabel(settings.provider);
  refs.worldCupApiUsage.textContent = `${provider} · ${enabled} · ${hasKey} · 今日 ${usage.used ?? 0}/${usage.softLimit ?? 80}/${usage.hardLimit ?? 100}`;
  refs.worldCupApiUsage.className = `table-badge ${settings.enabled && settings.hasApiKey ? "status-active" : "status-disabled"}`;
}

function getWorldCupProviderLabel(provider) {
  return "Zafronix";
}

function getWorldCupProviderDefaultBaseUrl(provider, defaults = {}) {
  return defaults.zafronixBaseUrl || "https://api.zafronix.com/fifa/worldcup/v1";
}

function getWorldCupProviderKeyPlaceholder(provider) {
  return "请输入 Zafronix API Key";
}

const WORLD_CUP_SPORTTERY_BROWSER_ODDS_URL = "https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry?clientCode=3001";

function parseWorldCupSportteryOdd(value) {
  const number = Number(String(value || "").trim());
  return Number.isFinite(number) && number > 0 ? number : null;
}

function collectWorldCupSportteryLists(json, key) {
  if (!json || typeof json !== "object") return [];
  const result = [];
  const stack = [json];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current[key])) result.push(...current[key]);
    for (const value of Object.values(current)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return result;
}

function parseWorldCupSportteryBrowserMatch(item) {
  const pool = Array.isArray(item?.oddsList)
    ? item.oddsList.find((odds) => String(odds?.poolCode || "").toUpperCase() === "HAD")
    : null;
  const home = parseWorldCupSportteryOdd(pool?.h);
  const draw = parseWorldCupSportteryOdd(pool?.d);
  const away = parseWorldCupSportteryOdd(pool?.a);
  const homeTeam = String(item?.homeTeamAllName || item?.homeTeamAbbName || "").trim();
  const awayTeam = String(item?.awayTeamAllName || item?.awayTeamAbbName || "").trim();
  const date = String(item?.matchDate || item?.businessDate || "").trim().slice(0, 10);
  if (!home || !draw || !away || !homeTeam || !awayTeam || !date) return null;
  return { date, homeTeam, awayTeam, odds: { home, draw, away } };
}

async function fetchWorldCupSportteryBrowserOdds() {
  const url = new URL(WORLD_CUP_SPORTTERY_BROWSER_ODDS_URL);
  url.searchParams.set("_", String(Date.now()));
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json, text/plain, */*" }
    });
  } catch (error) {
    throw new Error(`浏览器无法访问体彩接口：${error?.message || error || "请求失败"}`);
  }
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`体彩接口返回非 JSON 内容，HTTP ${response.status}`);
  }
  if (!response.ok || json?.success === false || (json?.errorCode && String(json.errorCode) !== "0")) {
    throw new Error(json?.errorMessage || json?.message || `HTTP ${response.status}`);
  }
  const rawItems = collectWorldCupSportteryLists(json, "subMatchList");
  return rawItems.map(parseWorldCupSportteryBrowserMatch).filter(Boolean).slice(0, 300);
}

function fillWorldCupApiSettings(payload) {
  const settings = payload?.settings || {};
  const defaults = payload?.defaults || {};
  const provider = "zafronix";
  if (refs.worldCupApiProvider) refs.worldCupApiProvider.value = provider;
  if (refs.worldCupApiEnabled) refs.worldCupApiEnabled.value = settings.enabled ? "1" : "0";
  if (refs.worldCupApiKey) {
    refs.worldCupApiKey.value = "";
    refs.worldCupApiKey.placeholder = settings.hasApiKey ? "已配置，留空则保持原 Key" : getWorldCupProviderKeyPlaceholder(provider);
  }
  if (refs.worldCupApiBaseUrl) {
    refs.worldCupApiBaseUrl.value = settings.baseUrl || getWorldCupProviderDefaultBaseUrl(provider, defaults);
  }
  if (refs.worldCupApiTimezone) refs.worldCupApiTimezone.value = settings.timezone || defaults.timezone || "Asia/Shanghai";
  if (refs.worldCupApiSeason) refs.worldCupApiSeason.value = settings.worldCupSeason || defaults.worldCupSeason || 2026;
  if (refs.worldCupApiSoftLimit) refs.worldCupApiSoftLimit.value = settings.dailySoftLimit || defaults.dailySoftLimit || 80;
  if (refs.worldCupApiHardLimit) refs.worldCupApiHardLimit.value = settings.dailyHardLimit || defaults.dailyHardLimit || 100;
  if (refs.worldCupApiSyncIntervalMs) refs.worldCupApiSyncIntervalMs.value = settings.syncIntervalMs || defaults.syncIntervalMs || 60000;
  if (refs.worldCupApiClearKey) refs.worldCupApiClearKey.value = "0";
  renderWorldCupApiUsage(payload);
}

async function refreshWorldCupApiSettings() {
  if (!refs.worldCupApiSettingsForm) return;
  const payload = await api("/api/admin/sub2api/worldcup/api-football/settings");
  fillWorldCupApiSettings(payload);
  const settings = payload.settings || {};
  const usage = payload.usage || {};
  setHint(
    refs.worldCupApiSettingsResult,
    `当前 ${settings.enabled ? "已启用" : "未启用"}，${settings.hasApiKey ? "API Key 已保存" : "API Key 未配置"}。今日普通额度剩余 ${usage.remainingSoft ?? 0}，硬上限剩余 ${usage.remainingHard ?? 0}。`
  );
}

async function saveWorldCupApiSettings() {
  if (!refs.worldCupApiSettingsForm) return;
  const payload = {
    provider: "zafronix",
    enabled: refs.worldCupApiEnabled.value === "1",
    apiKey: refs.worldCupApiKey.value.trim(),
    clearApiKey: refs.worldCupApiClearKey.value === "1",
    baseUrl: refs.worldCupApiBaseUrl.value.trim(),
    timezone: refs.worldCupApiTimezone.value.trim(),
    worldCupLeagueId: 1,
    worldCupSeason: Number(refs.worldCupApiSeason.value || 2026),
    dailySoftLimit: Number(refs.worldCupApiSoftLimit.value || 80),
    dailyHardLimit: Number(refs.worldCupApiHardLimit.value || 100),
    syncIntervalMs: Number(refs.worldCupApiSyncIntervalMs.value || 60000)
  };
  if (!payload.apiKey) delete payload.apiKey;

  try {
    setHint(refs.worldCupApiSettingsResult, "正在保存世界杯 API 配置...");
    setButtonBusy(refs.worldCupApiSettingsSubmitBtn, true, "保存中...");
    const response = await api("/api/admin/sub2api/worldcup/api-football/settings", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    fillWorldCupApiSettings(response);
    const usage = response.usage || {};
    setHint(refs.worldCupApiSettingsResult, `配置已保存。今日已用 ${usage.used ?? 0}，软上限 ${usage.softLimit ?? 80}，硬上限 ${usage.hardLimit ?? 100}。`);
  } catch (error) {
    setHint(refs.worldCupApiSettingsResult, `保存失败：${error.message}`);
  } finally {
    setButtonBusy(refs.worldCupApiSettingsSubmitBtn, false);
  }
}

async function runWorldCupManualSync() {
  if (!refs.worldCupApiManualSyncBtn) return;
  try {
    setHint(refs.worldCupApiSettingsResult, "正在从浏览器获取体彩赔率...");
    setButtonBusy(refs.worldCupApiManualSyncBtn, true, "同步中...");
    let sportteryOddsMatches = [];
    let sportteryBrowserError = "";
    try {
      sportteryOddsMatches = await fetchWorldCupSportteryBrowserOdds();
      setHint(refs.worldCupApiSettingsResult, `浏览器已获取体彩赔率 ${sportteryOddsMatches.length} 场，正在触发 worker 同步赛事...`);
    } catch (error) {
      sportteryBrowserError = String(error?.message || error || "").slice(0, 180);
      setHint(refs.worldCupApiSettingsResult, `浏览器获取体彩赔率失败：${sportteryBrowserError}。正在改用 ESPN 赔率同步...`);
    }
    const response = await api("/api/admin/sub2api/worldcup/api-football/sync", {
      method: "POST",
      body: JSON.stringify({ sportteryOddsMatches, sportteryBrowserError })
    });
    fillWorldCupApiSettings(response);
    const usage = response.usage || {};
    const stats = response.worker?.stats || {};
    const discovery = stats.discovery || {};
    const tracked = stats.tracked || {};
    const odds = stats.upcomingOdds || {};
    const settle = stats.settle || {};
    const cancel = stats.cancel || {};
    const provider = getWorldCupProviderLabel(response.settings?.provider);
    const emptyHint = Number(discovery.fixturesReturned || 0) === 0
      ? `${provider} 未返回赛事，请检查数据源、赛季、API Key/Token 权限或当前日期是否有赛程。`
      : "";
    const oddsRaw = odds.source === "draw" ? (odds.drawRaw ?? 0) : (odds.uniformRaw ?? 0);
    const oddsParsed = odds.source === "draw" ? (odds.drawParsed ?? 0) : (odds.uniformParsed ?? 0);
    const oddsDetail = odds.source
      ? `，来源 ${odds.source}，原始 ${oddsRaw} 场，解析 ${oddsParsed} 场`
      : "";
    const oddsError = odds.error ? `，错误：${odds.error}` : "";
    const oddsHint = odds.returned !== undefined || odds.matched !== undefined
      ? `赔率目标 ${odds.targets ?? 0} 场，返回 ${odds.returned ?? 0} 场${oddsDetail}，匹配 ${odds.matched ?? 0} 场，失败 ${odds.failed ?? 0} 次${oddsError}，赔率更新 ${Number(odds.updated || 0) + Number(tracked.halftimeOddsUpdated || 0)} 条`
      : `赔率更新 ${Number(odds.updated || 0) + Number(tracked.halftimeOddsUpdated || 0)} 条`;
    setHint(
      refs.worldCupApiSettingsResult,
      [
        `已触发同步：${provider} 返回 ${discovery.fixturesReturned ?? 0} 场，筛选 ${discovery.fixturesSeen ?? 0} 场，写入 ${discovery.rowsSynced ?? 0} 条，清理旧赛事 ${discovery.rowsPruned ?? 0} 条；刷新 ${tracked.refreshed ?? 0} 场，${oddsHint}，结算 ${settle.settled ?? 0} 场，取消 ${cancel.cancelled ?? 0} 场。`,
        `今日已用 ${usage.used ?? 0}，软上限 ${usage.softLimit ?? 80}，硬上限 ${usage.hardLimit ?? 100}。`,
        emptyHint
      ].filter(Boolean).join(" ")
    );
    await refreshWorldCupMatches().catch(() => {});
    await refreshWorldCupBets().catch(() => {});
  } catch (error) {
    setHint(refs.worldCupApiSettingsResult, `立即同步失败：${error.message}`);
  } finally {
    setButtonBusy(refs.worldCupApiManualSyncBtn, false);
  }
}

async function refreshSub2ApiConsole() {
  await refreshWorldCupApiSettings().catch((error) => {
    setHint(refs.worldCupApiSettingsResult, `加载 Zafronix 配置失败：${error.message}`);
  });
  await refreshSub2ApiConnections().catch((error) => {
    if (refs.sub2apiConnectionList) refs.sub2apiConnectionList.innerHTML = `<p class="hint centered">加载连接失败：${escapeHtml(error.message)}</p>`;
  });
  await refreshSub2ApiUpstreamMonitors().catch((error) => {
    if (refs.sub2apiUpstreamMonitorList) refs.sub2apiUpstreamMonitorList.innerHTML = `<p class="hint centered">加载上游监控失败：${escapeHtml(error.message)}</p>`;
  });
  await refreshSub2ApiModelRoutes().catch((error) => {
    if (refs.sub2apiModelRouteList) refs.sub2apiModelRouteList.innerHTML = `<p class="hint centered">加载模型路由失败：${escapeHtml(error.message)}</p>`;
  });
  await refreshSub2ApiPlans().catch((error) => {
    if (refs.sub2apiPlanList) refs.sub2apiPlanList.innerHTML = `<p class="hint centered">加载订阅套餐失败：${escapeHtml(error.message)}</p>`;
  });
  await refreshSub2ApiOrders().catch((error) => {
    if (refs.sub2apiOrderList) refs.sub2apiOrderList.innerHTML = `<p class="hint centered">加载订阅订单失败：${escapeHtml(error.message)}</p>`;
  });
  await refreshSub2ApiInvites().catch((error) => {
    if (refs.sub2apiInviteList) refs.sub2apiInviteList.innerHTML = `<p class="hint centered">加载邀请码失败：${escapeHtml(error.message)}</p>`;
  });
  await loadSub2ApiInviterLevels().catch((error) => {
    setHint(refs.sub2apiLevelResult, `加载等级失败：${error.message}`);
  });
  await refreshSub2ApiRebates().catch((error) => {
    if (refs.sub2apiRebateList) refs.sub2apiRebateList.innerHTML = `<p class="hint centered">加载返利失败：${escapeHtml(error.message)}</p>`;
  });
  await refreshWorldCupMatches().catch((error) => {
    if (refs.worldCupMatchList) refs.worldCupMatchList.innerHTML = `<p class="hint centered">加载比赛失败：${escapeHtml(error.message)}</p>`;
  });
  await refreshWorldCupBets().catch((error) => {
    if (refs.worldCupBetList) refs.worldCupBetList.innerHTML = `<p class="hint centered">加载竞猜记录失败：${escapeHtml(error.message)}</p>`;
  });
}

function exportSub2ApiInvitesCsv() {
  if (!sub2apiInvitesCache.length) {
    setHint(refs.sub2apiInviteResult, "无数据可导出");
    return;
  }
  const headers = ["连接", "连接ID", "用户ID", "邮箱", "用户名", "邀请码", "远端ID", "状态", "创建时间", "过期时间", "错误"];
  const escapeCsv = (value) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  const lines = [
    headers.map(escapeCsv).join(","),
    ...sub2apiInvitesCache.map((item) => [
      item.connectionName,
      item.connectionId,
      item.userId,
      item.email,
      item.username,
      item.inviteCode,
      item.remoteInviteId,
      item.status,
      item.createdAt,
      item.expiresAt,
      item.errorMessage
    ].map(escapeCsv).join(","))
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sub2api-invites-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  setHint(refs.sub2apiInviteResult, `已导出 ${sub2apiInvitesCache.length} 条记录`);
}

function formatWorldCupAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toFixed(2).replace(/\.00$/, "");
}

const WORLD_CUP_BEIJING_TIMEZONE = "Asia/Shanghai";
const WORLD_CUP_BEIJING_OFFSET_MINUTES = 8 * 60;
const worldCupBeijingFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: WORLD_CUP_BEIJING_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

function getWorldCupBeijingParts(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(
    worldCupBeijingFormatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) return null;
  return parts;
}

function formatWorldCupTime(value) {
  if (!value) return "-";
  const parts = getWorldCupBeijingParts(value);
  if (!parts) return String(value);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second || "00"} 北京时间`;
}

function toWorldCupDateTimeLocal(value) {
  if (!value) return "";
  const parts = getWorldCupBeijingParts(value);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function fromWorldCupDateTimeLocal(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute) - WORLD_CUP_BEIJING_OFFSET_MINUTES * 60000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function getWorldCupMatchTitle(item) {
  return `${item.homeTeam || "-"} 对阵 ${item.awayTeam || "-"}`;
}

function resetWorldCupMatchForm() {
  if (!refs.worldCupMatchForm) return;
  refs.worldCupMatchForm.reset();
  refs.worldCupMatchEditId.value = "";
  refs.worldCupMatchFormTitle.textContent = "添加世界杯比赛";
  refs.worldCupMatchSubmitBtn.textContent = "保存比赛";
  refs.worldCupMatchCancelBtn.classList.add("hidden");
  refs.worldCupMatchStatus.value = "open";
  refs.worldCupOddsHome.value = "1.8";
  refs.worldCupOddsDraw.value = "3.2";
  refs.worldCupOddsAway.value = "1.8";
  refs.worldCupMinStake.value = "0.1";
  refs.worldCupMaxStake.value = "2";
  if (sub2apiConnectionsCache.length === 1) {
    refs.worldCupMatchConnection.value = sub2apiConnectionsCache[0].id;
  }
}

function populateWorldCupMatchFilter() {
  if (!refs.worldCupBetMatchFilter) return;
  const current = refs.worldCupBetMatchFilter.value;
  refs.worldCupBetMatchFilter.innerHTML = [`<option value="">全部比赛</option>`]
    .concat(worldCupMatchesCache.map((item) => `
      <option value="${escapeHtml(item.id)}">${escapeHtml(getWorldCupMatchTitle(item))}</option>
    `))
    .join("");
  if (worldCupMatchesCache.some((item) => item.id === current)) {
    refs.worldCupBetMatchFilter.value = current;
  }
}

async function refreshWorldCupMatches() {
  if (!refs.worldCupMatchList) return;
  const params = new URLSearchParams();
  if (refs.worldCupMatchConnectionFilter?.value) params.set("connectionId", refs.worldCupMatchConnectionFilter.value);
  if (refs.worldCupMatchStatusFilter?.value) params.set("status", refs.worldCupMatchStatusFilter.value);

  const payload = await api(`/api/admin/sub2api/worldcup/matches?${params.toString()}`);
  worldCupMatchesCache = payload.items || [];
  populateWorldCupMatchFilter();

  renderTable(refs.worldCupMatchList, [
    {
      label: "比赛",
      render: (item) => `
        <strong>${escapeHtml(getWorldCupMatchTitle(item))}</strong><br/>
        <span style="font-size:12px;color:var(--muted)">${escapeHtml(item.stage || "-")}${item.groupName ? ` · ${escapeHtml(item.groupName)}` : ""}</span><br/>
        <span class="hint">${escapeHtml(item.source || "manual")}${item.apiFixtureId ? ` · fixture ${escapeHtml(item.apiFixtureId)}` : ""}</span>
      `
    },
    {
      label: "连接",
      render: (item) => `${escapeHtml(item.connectionName || "-")}<br/><code style="font-size:11px">${escapeHtml(item.connectionId)}</code>`
    },
    {
      label: "开赛（北京时间）",
      render: (item) => `<span style="font-size:12px">${escapeHtml(formatWorldCupTime(item.kickoffAt))}</span>`
    },
    {
      label: "状态",
      render: (item) => `
        ${renderStatus(item.status)}${item.bettingOpen ? `<br/><span class="hint">${escapeHtml(item.bettingPhaseLabel || "可下注")}</span>` : ""}
        ${item.apiStatusShort ? `<br/><span class="hint">API ${escapeHtml(item.apiStatusShort)}${item.apiElapsed ? ` · ${escapeHtml(item.apiElapsed)}'` : ""}</span>` : ""}
        ${item.apiLastSyncedAt ? `<br/><span class="hint">${escapeHtml(formatWorldCupTime(item.apiLastSyncedAt))}</span>` : ""}
      `
    },
    {
      label: "比分",
      render: (item) => item.homeScore === null || item.homeScore === undefined
        ? "-"
        : `<strong>${escapeHtml(item.homeScore)} - ${escapeHtml(item.awayScore)}</strong><br/><span class="hint">${escapeHtml(item.resultLabel || "-")}</span>`
    },
    {
      label: "赔率",
      render: (item) => `
        <div style="font-size:12px;line-height:1.5">
          <div>主胜 ${escapeHtml(formatWorldCupAmount(item.odds?.home))}</div>
          <div>平局 ${escapeHtml(formatWorldCupAmount(item.odds?.draw))}</div>
          <div>客胜 ${escapeHtml(formatWorldCupAmount(item.odds?.away))}</div>
          ${item.oddsLastSyncedAt ? `<div class="hint">${escapeHtml(formatWorldCupTime(item.oddsLastSyncedAt))}</div>` : ""}
        </div>
      `
    },
    {
      label: "投注",
      render: (item) => `${escapeHtml(formatWorldCupAmount(item.minStake))} - ${escapeHtml(formatWorldCupAmount(item.maxStake))}`
    },
    {
      label: "操作",
      render: (item) => `
        <button class="primary-btn small" type="button" onclick="editWorldCupMatch('${escapeHtml(item.id)}')">编辑</button>
        <button class="ghost-btn small" type="button" onclick="settleWorldCupMatch('${escapeHtml(item.id)}')">结算</button>
        <button class="ghost-btn small" type="button" onclick="cancelWorldCupMatch('${escapeHtml(item.id)}')">取消并退款</button>
        <button class="ghost-btn small" type="button" style="color:var(--error)" onclick="deleteWorldCupMatch('${escapeHtml(item.id)}')">删除</button>
      `
    }
  ], worldCupMatchesCache, "暂无世界杯比赛");
}

function editWorldCupMatch(id) {
  const item = worldCupMatchesCache.find((entry) => entry.id === id);
  if (!item || !refs.worldCupMatchForm) return;
  refs.worldCupMatchEditId.value = item.id;
  refs.worldCupMatchConnection.value = item.connectionId || "";
  refs.worldCupMatchStage.value = item.stage || "";
  refs.worldCupMatchGroup.value = item.groupName || "";
  refs.worldCupMatchHome.value = item.homeTeam || "";
  refs.worldCupMatchAway.value = item.awayTeam || "";
  refs.worldCupMatchKickoff.value = toWorldCupDateTimeLocal(item.kickoffAt);
  refs.worldCupMatchStatus.value = item.status || "open";
  refs.worldCupOddsHome.value = item.odds?.home ?? "1.8";
  refs.worldCupOddsDraw.value = item.odds?.draw ?? "3.2";
  refs.worldCupOddsAway.value = item.odds?.away ?? "1.8";
  refs.worldCupMinStake.value = item.minStake ?? "0.1";
  refs.worldCupMaxStake.value = item.maxStake ?? "2";
  refs.worldCupMatchNote.value = item.note || "";
  refs.worldCupMatchFormTitle.textContent = `编辑比赛：${getWorldCupMatchTitle(item)}`;
  refs.worldCupMatchSubmitBtn.textContent = "保存修改";
  refs.worldCupMatchCancelBtn.classList.remove("hidden");
  refs.worldCupMatchForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveWorldCupMatch() {
  const id = refs.worldCupMatchEditId?.value || "";
  const payload = {
    connectionId: refs.worldCupMatchConnection.value,
    stage: refs.worldCupMatchStage.value.trim(),
    groupName: refs.worldCupMatchGroup.value.trim(),
    homeTeam: refs.worldCupMatchHome.value.trim(),
    awayTeam: refs.worldCupMatchAway.value.trim(),
    kickoffAt: fromWorldCupDateTimeLocal(refs.worldCupMatchKickoff.value),
    status: refs.worldCupMatchStatus.value,
    oddsHome: Number(refs.worldCupOddsHome.value),
    oddsDraw: Number(refs.worldCupOddsDraw.value),
    oddsAway: Number(refs.worldCupOddsAway.value),
    minStake: Number(refs.worldCupMinStake.value),
    maxStake: Number(refs.worldCupMaxStake.value),
    note: refs.worldCupMatchNote.value.trim()
  };
  if (!payload.connectionId || !payload.homeTeam || !payload.awayTeam || !payload.kickoffAt) {
    setHint(refs.worldCupMatchResult, "请填写连接、球队和开赛时间");
    return;
  }

  try {
    setHint(refs.worldCupMatchResult, "正在保存...");
    await api(id ? `/api/admin/sub2api/worldcup/matches/${encodeURIComponent(id)}` : "/api/admin/sub2api/worldcup/matches", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    setHint(refs.worldCupMatchResult, "比赛已保存");
    resetWorldCupMatchForm();
    await refreshWorldCupMatches();
    await refreshWorldCupBets();
  } catch (error) {
    setHint(refs.worldCupMatchResult, `保存失败：${error.message}`);
  }
}

async function deleteWorldCupMatch(id) {
  if (!window.confirm("确认删除该比赛？已有投注时不能删除。")) return;
  try {
    await api(`/api/admin/sub2api/worldcup/matches/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({})
    });
    setHint(refs.worldCupMatchResult, "比赛已删除");
    await refreshWorldCupMatches();
  } catch (error) {
    setHint(refs.worldCupMatchResult, `删除失败：${error.message}`);
  }
}

async function settleWorldCupMatch(id) {
  const item = worldCupMatchesCache.find((entry) => entry.id === id);
  if (!item) return;
  const homeScore = window.prompt(`${item.homeTeam} 进球数`, item.homeScore ?? "");
  if (homeScore === null) return;
  const awayScore = window.prompt(`${item.awayTeam} 进球数`, item.awayScore ?? "");
  if (awayScore === null) return;
  try {
    setHint(refs.worldCupMatchResult, "正在结算...");
    const payload = await api(`/api/admin/sub2api/worldcup/matches/${encodeURIComponent(id)}/settle`, {
      method: "POST",
      body: JSON.stringify({ homeScore: Number(homeScore), awayScore: Number(awayScore) })
    });
    const stats = payload.stats || {};
    const failedPayouts = Array.isArray(stats.payouts)
      ? stats.payouts.filter((item) => item.status === "payout_failed")
      : [];
    const failureHint = failedPayouts.length
      ? `；失败明细：${failedPayouts.map((item) => `${item.userId || "-"} ${item.errorMessage || "派奖失败"}`).join("；")}`
      : "";
    setHint(
      refs.worldCupMatchResult,
      `结算完成：中奖 ${stats.won || 0}，未中 ${stats.lost || 0}，派奖失败 ${stats.payoutFailed || 0}，派奖 ${formatWorldCupAmount(stats.payoutTotal || 0)}${failureHint}`
    );
    await refreshWorldCupMatches();
    await refreshWorldCupBets();
  } catch (error) {
    setHint(refs.worldCupMatchResult, `结算失败：${error.message}`);
  }
}

async function cancelWorldCupMatch(id) {
  if (!window.confirm("确认取消该比赛并退还未结算投注？")) return;
  try {
    setHint(refs.worldCupMatchResult, "正在取消并退款...");
    const payload = await api(`/api/admin/sub2api/worldcup/matches/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({})
    });
    const stats = payload.stats || {};
    setHint(refs.worldCupMatchResult, `取消完成：已退款 ${stats.refunded || 0}，退款失败 ${stats.refundFailed || 0}`);
    await refreshWorldCupMatches();
    await refreshWorldCupBets();
  } catch (error) {
    setHint(refs.worldCupMatchResult, `取消失败：${error.message}`);
  }
}

async function refreshWorldCupBets() {
  if (!refs.worldCupBetList) return;
  const state = getTableState(refs.worldCupBetList);
  const params = new URLSearchParams();
  if (refs.worldCupBetConnectionFilter?.value) params.set("connectionId", refs.worldCupBetConnectionFilter.value);
  if (refs.worldCupBetMatchFilter?.value) params.set("matchId", refs.worldCupBetMatchFilter.value);
  if (refs.worldCupBetUserFilter?.value.trim()) params.set("userId", refs.worldCupBetUserFilter.value.trim());
  if (refs.worldCupBetStatusFilter?.value) params.set("status", refs.worldCupBetStatusFilter.value);
  params.set("page", String(state.page || 1));
  params.set("pageSize", String(state.pageSize || DEFAULT_TABLE_PAGE_SIZE));

  const payload = await api(`/api/admin/sub2api/worldcup/bets?${params.toString()}`);
  worldCupBetsCache = payload.items || [];

  renderTable(refs.worldCupBetList, [
    {
      label: "比赛",
      render: (item) => item.match
        ? `<strong>${escapeHtml(item.match.homeTeam)} 对阵 ${escapeHtml(item.match.awayTeam)}</strong><br/><span class="hint">${escapeHtml(formatWorldCupTime(item.match.kickoffAt))}</span>`
        : escapeHtml(item.matchId)
    },
    {
      label: "账号",
      render: (item) => `
        <div style="font-size:12px;line-height:1.5">
          <div><code>${escapeHtml(item.userId)}</code></div>
          <div>${escapeHtml(item.email || item.username || "-")}</div>
        </div>
      `
    },
    {
      label: "选择",
      render: (item) => escapeHtml(item.predictionLabel || item.prediction)
    },
    {
      label: "投注/赔率",
      render: (item) => `${escapeHtml(formatWorldCupAmount(item.stake))} × ${escapeHtml(formatWorldCupAmount(item.odds))}`
    },
    {
      label: "状态",
      render: (item) => renderStatus(item.status)
    },
    {
      label: "派奖",
      render: (item) => escapeHtml(formatWorldCupAmount(item.payout))
    },
    {
      label: "时间",
      render: (item) => `<span style="font-size:12px">${escapeHtml(formatWorldCupTime(item.createdAt))}</span>`
    },
    {
      label: "错误",
      render: (item) => item.errorMessage ? `<span style="color:var(--error)" title="${escapeHtml(item.errorMessage)}">${escapeHtml(item.errorMessage.slice(0, 42))}</span>` : "-"
    }
  ], worldCupBetsCache, "暂无竞猜记录", {
    server: true,
    total: Number(payload.total ?? worldCupBetsCache.length),
    page: Number(payload.page ?? state.page),
    pageSize: Number(payload.pageSize ?? state.pageSize),
    onPageChange: () => refreshWorldCupBets().catch((error) => {
      refs.worldCupBetList.innerHTML = `<p class="hint centered">加载竞猜记录失败：${escapeHtml(error.message)}</p>`;
    })
  });
  setHint(refs.worldCupBetResult, `共 ${payload.total ?? worldCupBetsCache.length} 条记录，当前显示 ${worldCupBetsCache.length} 条`);
}

function exportWorldCupBetsCsv() {
  if (!worldCupBetsCache.length) {
    setHint(refs.worldCupBetResult, "无数据可导出");
    return;
  }
  const headers = ["连接", "用户ID", "邮箱", "比赛", "选择", "投注", "赔率", "状态", "派奖", "创建时间", "结算时间", "错误"];
  const escapeCsv = (value) => `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  const lines = [
    headers.map(escapeCsv).join(","),
    ...worldCupBetsCache.map((item) => [
      item.connectionName || item.connectionId,
      item.userId,
      item.email,
      item.match ? `${item.match.homeTeam} 对阵 ${item.match.awayTeam}` : item.matchId,
      item.predictionLabel,
      item.stake,
      item.odds,
      item.status,
      item.payout,
      formatWorldCupTime(item.createdAt),
      item.settledAt ? formatWorldCupTime(item.settledAt) : "",
      item.errorMessage
    ].map(escapeCsv).join(","))
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sub2api-worldcup-bets-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  setHint(refs.worldCupBetResult, `已导出 ${worldCupBetsCache.length} 条记录`);
}

window.editSub2ApiConnection = editSub2ApiConnection;
window.testSub2ApiConnection = testSub2ApiConnection;
window.deleteSub2ApiConnection = deleteSub2ApiConnection;
window.editSub2ApiPlan = editSub2ApiPlan;
window.deleteSub2ApiPlan = deleteSub2ApiPlan;
window.editWorldCupMatch = editWorldCupMatch;
window.deleteWorldCupMatch = deleteWorldCupMatch;
window.settleWorldCupMatch = settleWorldCupMatch;
window.cancelWorldCupMatch = cancelWorldCupMatch;

if (refs.shakeCampaignForm) {
  refs.shakeCampaignForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveShakeCampaign().catch(() => {});
  });
  resetShakeCampaignForm();
}

if (refs.shakePrizeEditor) {
  refs.shakePrizeEditor.addEventListener("change", (event) => {
    if (!event.target.matches("[data-field=type]")) return;
    const amount = event.target.closest("[data-shake-prize-row]")?.querySelector("[data-field=amount]");
    if (amount) {
      amount.disabled = event.target.value !== "balance";
      if (amount.disabled) amount.value = "";
    }
  });
  refs.shakePrizeEditor.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-prize]");
    if (!button) return;
    const prizes = collectShakePrizes();
    prizes.splice(Number(button.dataset.removePrize), 1);
    renderShakePrizeEditor(prizes);
  });
}

if (refs.shakeSubscriptionRuleEditor) {
  refs.shakeSubscriptionRuleEditor.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-subscription-rule]");
    if (!button) return;
    const rules = collectShakeSubscriptionRules();
    rules.splice(Number(button.dataset.removeSubscriptionRule), 1);
    renderShakeSubscriptionRuleEditor(rules);
  });
}

refs.shakeAddSubscriptionRuleBtn?.addEventListener("click", () => {
  renderShakeSubscriptionRuleEditor(collectShakeSubscriptionRules().concat({
    subscriptionGroupId: "", cardTier: "low", cardQuantity: 1
  }));
});

if (refs.shakeUsageRuleEditor) {
  refs.shakeUsageRuleEditor.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-usage-rule]");
    if (!button) return;
    const rules = collectShakeUsageRules();
    rules.splice(Number(button.dataset.removeUsageRule), 1);
    renderShakeUsageRuleEditor(rules);
  });
}

refs.shakeAddUsageRuleBtn?.addEventListener("click", () => {
  renderShakeUsageRuleEditor(collectShakeUsageRules().concat({
    subscriptionGroupId: "", threshold: "", cardTier: "low"
  }));
});

refs.shakeAddPrizeBtn?.addEventListener("click", () => {
  renderShakePrizeEditor(collectShakePrizes().concat({
    name: "", type: "empty", amount: null, weights: { low: 1, medium: 1, high: 1 },
    rarity: "common", displayText: "", icon: ""
  }));
});

refs.shakeCampaignResetBtn?.addEventListener("click", () => {
  resetShakeCampaignForm();
  setHint(refs.shakeCampaignResult, "");
});

refs.shakeCampaignConnection?.addEventListener("change", updateShakeEmbedUrl);
refs.shakeCampaignFilter?.addEventListener("change", () => {
  refreshShakeCampaigns().catch((error) => setHint(refs.shakeCampaignResult, error.message));
});
refs.shakeCampaignRefreshBtn?.addEventListener("click", () => {
  refreshShakeCampaigns().catch((error) => setHint(refs.shakeCampaignResult, error.message));
});
refs.shakeSyncUsageBtn?.addEventListener("click", () => syncShakeUsage().catch(() => {}));
refs.shakeManualGrantForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  grantShakeCards().catch(() => {});
});
refs.shakeDrawRefreshBtn?.addEventListener("click", () => {
  refreshShakeDraws().catch((error) => setHint(refs.shakeDrawResult, error.message));
});
refs.shakeCopyEmbedBtn?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(refs.shakeEmbedUrl.value);
    setHint(refs.shakeEmbedResult, "嵌入地址已复制");
  } catch {
    refs.shakeEmbedUrl.select();
    setHint(refs.shakeEmbedResult, "已选中地址，请手动复制");
  }
});

if (refs.sub2apiConnectionForm) {
  refs.sub2apiConnectionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSub2ApiConnection().catch(() => {});
  });
}

if (refs.sub2apiConnectionCancelBtn) {
  refs.sub2apiConnectionCancelBtn.addEventListener("click", () => {
    resetSub2ApiConnectionForm();
    setHint(refs.sub2apiConnectionResult, "");
  });
}

if (refs.sub2apiConnectionRefreshBtn) {
  refs.sub2apiConnectionRefreshBtn.addEventListener("click", () => {
    refreshSub2ApiConsole().catch(() => {});
  });
}

if (refs.sub2apiUpstreamMonitorRefreshBtn) {
  refs.sub2apiUpstreamMonitorRefreshBtn.addEventListener("click", () => {
    refreshSub2ApiUpstreamMonitors().catch((error) => setHint(refs.sub2apiUpstreamMonitorResult, `刷新失败：${error.message}`));
  });
}

if (refs.sub2apiUpstreamMonitorConnection) {
  refs.sub2apiUpstreamMonitorConnection.addEventListener("change", () => {
    refreshSub2ApiUpstreamMonitors().catch((error) => setHint(refs.sub2apiUpstreamMonitorResult, `加载失败：${error.message}`));
  });
}

if (refs.sub2apiModelRouteRefreshBtn) {
  refs.sub2apiModelRouteRefreshBtn.addEventListener("click", () => {
    resetTablePage(refs.sub2apiModelRouteList);
    refreshSub2ApiModelRoutes({ force: true }).catch((error) => setHint(refs.sub2apiModelRouteResult, `刷新失败：${error.message}`));
  });
}

if (refs.sub2apiModelRouteConnection) {
  refs.sub2apiModelRouteConnection.addEventListener("change", () => {
    resetTablePage(refs.sub2apiModelRouteList);
    refreshSub2ApiModelRoutes({ force: true }).catch((error) => setHint(refs.sub2apiModelRouteResult, `加载失败：${error.message}`));
  });
}

if (refs.sub2apiModelRouteFilter) {
  refs.sub2apiModelRouteFilter.addEventListener("input", () => {
    resetTablePage(refs.sub2apiModelRouteList);
    refreshSub2ApiModelRoutes().catch((error) => setHint(refs.sub2apiModelRouteResult, `筛选失败：${error.message}`));
  });
}

if (refs.sub2apiInviteRefreshBtn) {
  refs.sub2apiInviteRefreshBtn.addEventListener("click", () => {
    resetTablePage(refs.sub2apiInviteList);
    refreshSub2ApiInvites().catch((error) => setHint(refs.sub2apiInviteResult, `查询失败：${error.message}`));
  });
}

if (refs.sub2apiInviteSyncBtn) {
  refs.sub2apiInviteSyncBtn.addEventListener("click", () => {
    syncSub2ApiInvites().catch((error) => setHint(refs.sub2apiInviteResult, `同步失败：${error.message}`));
  });
}

if (refs.sub2apiInviteCopyBtn) {
  refs.sub2apiInviteCopyBtn.addEventListener("click", async () => {
    const codes = getSelectedSub2ApiInviteCodes();
    if (!codes.length) {
      setHint(refs.sub2apiInviteResult, "暂无可复制的邀请码");
      return;
    }
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setHint(refs.sub2apiInviteResult, `已复制 ${codes.length} 个邀请码`);
    } catch {
      setHint(refs.sub2apiInviteResult, "复制失败：剪贴板写入被拒绝");
    }
  });
}

if (refs.sub2apiInviteExportBtn) {
  refs.sub2apiInviteExportBtn.addEventListener("click", exportSub2ApiInvitesCsv);
}

if (refs.sub2apiLevelLoadBtn) {
  refs.sub2apiLevelLoadBtn.addEventListener("click", () => {
    loadSub2ApiInviterLevels().catch((error) => setHint(refs.sub2apiLevelResult, `读取失败：${error.message}`));
  });
}

if (refs.sub2apiLevelRecommendedBtn) {
  refs.sub2apiLevelRecommendedBtn.addEventListener("click", () => {
    const templateName = refs.sub2apiLevelTemplate?.value || "niu";
    const template = SUB2API_LEVEL_TEMPLATES[templateName] || SUB2API_LEVEL_TEMPLATES.niu;
    sub2apiLevelsCache = template.map((level) => ({ ...level }));
    renderSub2ApiInviterLevels();
    setHint(refs.sub2apiLevelResult, "已套用模板，确认后点击“保存并重算”。");
  });
}

if (refs.sub2apiLevelAddBtn) {
  refs.sub2apiLevelAddBtn.addEventListener("click", () => {
    sub2apiLevelsCache = refs.sub2apiLevelList?.querySelector("tr[data-level-index]")
      ? collectSub2ApiInviterLevels()
      : sub2apiLevelsCache;
    addSub2ApiInviterLevel();
    setHint(refs.sub2apiLevelResult, "已新增等级，填写后点击“保存并重算”。");
  });
}

if (refs.sub2apiLevelSaveBtn) {
  refs.sub2apiLevelSaveBtn.addEventListener("click", () => {
    saveSub2ApiInviterLevels().catch((error) => setHint(refs.sub2apiLevelResult, `保存失败：${error.message}`));
  });
}

if (refs.sub2apiLevelList) {
  refs.sub2apiLevelList.addEventListener("click", (event) => {
    const button = event.target.closest(".sub2api-level-remove");
    if (!button) return;
    const row = button.closest("tr[data-level-index]");
    const index = Number(row?.dataset.levelIndex);
    sub2apiLevelsCache = collectSub2ApiInviterLevels().filter((_, itemIndex) => itemIndex !== index);
    renderSub2ApiInviterLevels();
    setHint(refs.sub2apiLevelResult, "已删除等级，点击“保存并重算”后生效。");
  });
}

if (refs.sub2apiRebateRefreshBtn) {
  refs.sub2apiRebateRefreshBtn.addEventListener("click", () => {
    resetTablePage(refs.sub2apiRebateList);
    refreshSub2ApiRebates().catch((error) => setHint(refs.sub2apiRebateResult, `刷新失败：${error.message}`));
  });
}

if (refs.sub2apiRebateSyncBtn) {
  refs.sub2apiRebateSyncBtn.addEventListener("click", () => {
    syncSub2ApiInvites().catch((error) => setHint(refs.sub2apiRebateResult, `同步失败：${error.message}`));
  });
}

if (refs.sub2apiRebateList) {
  refs.sub2apiRebateList.addEventListener("click", (event) => {
    const button = event.target.closest(".sub2api-rebate-action");
    if (!button) return;
    runSub2ApiRebateAction(button.dataset.id, button.dataset.action)
      .catch((error) => setHint(refs.sub2apiRebateResult, `操作失败：${error.message}`));
  });
}

if (refs.sub2apiPlanForm) {
  refs.sub2apiPlanForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSub2ApiPlan().catch(() => {});
  });
}

if (refs.sub2apiPlanCancelBtn) {
  refs.sub2apiPlanCancelBtn.addEventListener("click", () => {
    resetSub2ApiPlanForm();
    setHint(refs.sub2apiPlanResult, "");
  });
}

if (refs.sub2apiPlanRefreshBtn) {
  refs.sub2apiPlanRefreshBtn.addEventListener("click", () => {
    refreshSub2ApiPlans().catch((error) => setHint(refs.sub2apiPlanResult, `刷新失败：${error.message}`));
  });
}

if (refs.sub2apiOrderRefreshBtn) {
  refs.sub2apiOrderRefreshBtn.addEventListener("click", () => {
    resetTablePage(refs.sub2apiOrderList);
    refreshSub2ApiOrders().catch((error) => setHint(refs.sub2apiOrderResult, `查询失败：${error.message}`));
  });
}

if (refs.worldCupApiSettingsForm) {
  refs.worldCupApiSettingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveWorldCupApiSettings().catch(() => {});
  });
}

if (refs.worldCupApiProvider) {
  refs.worldCupApiProvider.addEventListener("change", () => {
    const provider = refs.worldCupApiProvider.value;
    if (refs.worldCupApiBaseUrl) {
      refs.worldCupApiBaseUrl.value = getWorldCupProviderDefaultBaseUrl(provider);
    }
    if (refs.worldCupApiKey) {
      refs.worldCupApiKey.placeholder = getWorldCupProviderKeyPlaceholder(provider);
    }
  });
}

if (refs.worldCupApiSettingsRefreshBtn) {
  refs.worldCupApiSettingsRefreshBtn.addEventListener("click", () => {
    refreshWorldCupApiSettings().catch((error) => setHint(refs.worldCupApiSettingsResult, `刷新失败：${error.message}`));
  });
}

if (refs.worldCupApiManualSyncBtn) {
  refs.worldCupApiManualSyncBtn.addEventListener("click", () => {
    runWorldCupManualSync().catch(() => {});
  });
}

if (refs.worldCupMatchForm) {
  refs.worldCupMatchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveWorldCupMatch().catch(() => {});
  });
}

if (refs.worldCupMatchCancelBtn) {
  refs.worldCupMatchCancelBtn.addEventListener("click", () => {
    resetWorldCupMatchForm();
    setHint(refs.worldCupMatchResult, "");
  });
}

if (refs.worldCupMatchRefreshBtn) {
  refs.worldCupMatchRefreshBtn.addEventListener("click", () => {
    refreshWorldCupMatches().catch((error) => setHint(refs.worldCupMatchResult, `刷新失败：${error.message}`));
  });
}

if (refs.worldCupMatchConnectionFilter) {
  refs.worldCupMatchConnectionFilter.addEventListener("change", () => {
    refreshWorldCupMatches().catch(() => {});
  });
}

if (refs.worldCupMatchStatusFilter) {
  refs.worldCupMatchStatusFilter.addEventListener("change", () => {
    refreshWorldCupMatches().catch(() => {});
  });
}

if (refs.worldCupBetRefreshBtn) {
  refs.worldCupBetRefreshBtn.addEventListener("click", () => {
    resetTablePage(refs.worldCupBetList);
    refreshWorldCupBets().catch((error) => setHint(refs.worldCupBetResult, `查询失败：${error.message}`));
  });
}

if (refs.worldCupBetExportBtn) {
  refs.worldCupBetExportBtn.addEventListener("click", exportWorldCupBetsCsv);
}
async function refreshAll() {
  if (!getToken()) return;
  await Promise.all([
    refreshDashboard(),
    refreshSites(),
    refreshBatches(),
    refreshCdkeys(),
    refreshSmsEntries(),
    refreshOrders(),
    refreshJobs(),
    refreshLogs(),
    refreshSystemVersion(),
    refreshSubscriptions(),
    refreshNotifications(),
    refreshQuotaDashboard(),
    refreshQuotaSubCards(),
    refreshSub2ApiConsole(),
    refreshStoreFulfillmentConsole(),
    refreshExtensionDeliveryConsole(),
    refreshMembershipFulfillmentConsole()
  ]);
}

refs.navItems.forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.tab);
  });
});

refs.healthCheckAllBtn.addEventListener("click", () => {
  healthCheckAll().catch((error) => setHint(refs.siteResult, error.message));
});

refs.checkEnvironmentBtn?.addEventListener("click", () => {
  checkSystemEnvironment().catch((error) => setHint(refs.systemUpdateHint, error.message));
});

refs.checkUpdateBtn.addEventListener("click", async () => {
  setHint(refs.systemUpdateHint, "正在检查...");
  try {
    const payload = await api("/api/admin/system/check-update", {
      method: "POST",
      body: JSON.stringify({})
    });
    renderSystemInfo(payload);
  } catch (error) {
    setHint(refs.systemUpdateHint, error.message);
  }
});

refs.startUpdateBtn.addEventListener("click", async () => {
  if (!window.confirm("确认开始在线更新？")) return;
  setHint(refs.systemUpdateHint, "启动中...");
  try {
    const payload = await api("/api/admin/system/update", {
      method: "POST",
      body: JSON.stringify({})
    });
    renderSystemInfo(payload);
    startUpdatePolling();
  } catch (error) {
    setHint(refs.systemUpdateHint, error.message);
  }
});

refs.migrationBackupBtn?.addEventListener("click", () => {
  downloadMigrationBackup().catch((error) => setHint(refs.migrationBackupResult, error.message));
});

refs.migrationValidateBtn?.addEventListener("click", () => {
  validateMigrationPackage().catch((error) => setHint(refs.migrationRestoreResult, error.message));
});

refs.migrationConfirmInput?.addEventListener("input", () => {
  refs.migrationRestoreBtn.disabled = !migrationRestoreUploadId || refs.migrationConfirmInput.value.trim() !== "确认恢复";
});

refs.migrationRestoreFile?.addEventListener("change", () => {
  migrationRestoreUploadId = null;
  refs.migrationRestoreBtn.disabled = true;
  refs.migrationRestoreSummary.innerHTML = "";
  setHint(refs.migrationRestoreResult, "");
});

refs.migrationRestoreBtn?.addEventListener("click", () => {
  restoreMigrationPackage().catch((error) => setHint(refs.migrationRestoreResult, error.message));
});

refs.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.querySelector("#username").value.trim(),
        password: document.querySelector("#password").value
      })
    });
    setToken(payload.token);
    setAuthState(true, payload.username);
    switchTab(currentTab);
    startAutoRefresh();
    await refreshAll();
  } catch (error) {
    setHint(refs.loginResult, error.message);
  }
});

refs.extensionDeliverySettingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const enabled = refs.extensionDeliveryEnabled.value === "true";
  const clearToken = refs.extensionDeliveryClearSpacexcardToken.checked;
  if (enabled && clearToken) {
    setHint(refs.extensionDeliverySettingsResult, "清除 spacexcard Token 前请先将功能状态改为停用");
    return;
  }
  try {
    const allowedSiteSlugs = Array.from(refs.extensionDeliverySites.selectedOptions, option => option.value);
    await api("/api/admin/extension-delivery/settings", {
      method: "PUT",
      body: JSON.stringify({
        enabled,
        allowedSiteSlugs,
        spacexcardApiToken: refs.extensionDeliverySpacexcardToken.value.trim(),
        clearSpacexcardToken: clearToken
      })
    });
    setHint(refs.extensionDeliverySettingsResult, "扩展交付配置已保存");
    await refreshExtensionDeliveryConsole();
  } catch (error) {
    setHint(refs.extensionDeliverySettingsResult, error.message);
  }
});

refs.extensionDeliveryGenerateToken?.addEventListener("click", () => {
  runExtensionTokenAction("generate").catch((error) => setHint(refs.extensionDeliverySettingsResult, error.message));
});

refs.extensionDeliveryResetToken?.addEventListener("click", () => {
  runExtensionTokenAction("reset").catch((error) => setHint(refs.extensionDeliverySettingsResult, error.message));
});

refs.extensionDeliveryRevokeToken?.addEventListener("click", () => {
  runExtensionTokenAction("revoke").catch((error) => setHint(refs.extensionDeliverySettingsResult, error.message));
});

refs.extensionDeliveryCopyToken?.addEventListener("click", async () => {
  const token = refs.extensionDeliveryIssuedToken.value.trim();
  if (!token) return setHint(refs.extensionDeliverySettingsResult, "当前没有可复制的一次性 Token");
  try {
    await copyTextToClipboard(token);
    setHint(refs.extensionDeliverySettingsResult, "Extension Token 已复制，请粘贴到扩展设置页");
  } catch (error) {
    setHint(refs.extensionDeliverySettingsResult, error.message || "复制失败");
  }
});

refs.extensionDeliveryResume?.addEventListener("click", async () => {
  try {
    const payload = await api("/api/admin/extension-delivery/resume", {
      method: "POST",
      body: JSON.stringify({})
    });
    setHint(refs.extensionDeliverySettingsResult, `全局队列已恢复，revision=${payload.resumeRevision}`);
    await refreshExtensionDeliveryConsole();
  } catch (error) {
    setHint(refs.extensionDeliverySettingsResult, error.message);
  }
});

refs.extensionDeliveryRefresh?.addEventListener("click", () => {
  refreshExtensionDeliveryConsole().catch((error) => setHint(refs.extensionDeliverySettingsResult, error.message));
});

refs.extensionDeliveryQuery?.addEventListener("click", () => {
  refreshExtensionDeliveries().catch((error) => setHint(refs.extensionDeliveryListResult, error.message));
});

refs.extensionDeliveryListRefresh?.addEventListener("click", async () => {
  setButtonBusy(refs.extensionDeliveryListRefresh, true, "刷新中...");
  try {
    await refreshExtensionDeliveries();
    setHint(refs.extensionDeliveryListResult, `扩展交付列表已刷新：${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setHint(refs.extensionDeliveryListResult, error.message);
  } finally {
    setButtonBusy(refs.extensionDeliveryListRefresh, false);
  }
});

refs.automationGateForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  setButtonBusy(submitButton, true, "保存中...");
  try {
    await api("/api/admin/automation/settings", {
      method: "PUT",
      body: JSON.stringify({
        paymentGateEnabled: refs.automationGateEnabled.checked,
        configTtlSeconds: Number(refs.automationConfigTtl.value),
        credentials: {
          username: refs.automationGateUsername.value.trim(),
          password: refs.automationGatePassword.value
        },
        confirmation: "ENABLE_LIVE_AUTOMATION"
      })
    });
    refs.automationGatePassword.value = "";
    refs.automationGateConfirm.checked = false;
    setHint(refs.automationGateResult, refs.automationGateEnabled.checked
      ? "协议自动化付款 Gate 已开启"
      : "协议自动化付款 Gate 已关闭；新订单不会选卡、充值或提交");
    await refreshAutomationConsole();
  } catch (error) {
    setHint(refs.automationGateResult, error.message);
  } finally {
    setButtonBusy(submitButton, false);
  }
});

refs.automationProviderForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  setButtonBusy(submitButton, true, "同步中...");
  try {
    await api("/api/admin/automation/providers", {
      method: "POST",
      body: JSON.stringify({
        id: refs.automationProviderId.value || undefined,
        name: refs.automationProviderName.value.trim(),
        adapterKey: refs.automationProviderAdapter.value,
        baseUrl: refs.automationProviderBaseUrl.value.trim(),
        apiKey: refs.automationProviderApiKey.value.trim(),
        status: refs.automationProviderStatus.value
      })
    });
    resetAutomationProviderForm();
    setHint(refs.automationProviderResult, "站点已保存，API Key 已加密复用，/config 已同步");
    await refreshAutomationConsole();
  } catch (error) {
    setHint(refs.automationProviderResult, error.message);
  } finally {
    setButtonBusy(submitButton, false);
  }
});

refs.automationProviderCancel?.addEventListener("click", resetAutomationProviderForm);
refs.automationProviderRefresh?.addEventListener("click", () => {
  refreshAutomationConsole().catch((error) => setHint(refs.automationProviderResult, error.message));
});
refs.automationMappingProvider?.addEventListener("change", updateAutomationCapabilitySelects);

refs.automationMappingForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  setButtonBusy(submitButton, true, "保存中...");
  try {
    await api("/api/admin/automation/mappings", {
      method: "POST",
      body: JSON.stringify({
        id: refs.automationMappingId.value || undefined,
        storeMappingId: refs.automationMappingProduct.value,
        providerId: refs.automationMappingProvider.value,
        externalPlanId: refs.automationMappingPlan.value,
        regionCode: refs.automationMappingRegion.value,
        cardPlatformKey: refs.automationMappingCardPlatform.value,
        cardProductCode: refs.automationMappingCardProduct.value.trim(),
        capacityKey: refs.automationMappingCapacityKey.value.trim(),
        cardCapacity: Number(refs.automationMappingCardCapacity.value),
        fundingAmountUsd: Number(refs.automationMappingFunding.value),
        expectedMinAmount: Number(refs.automationMappingPriceMin.value),
        expectedMaxAmount: Number(refs.automationMappingPriceMax.value),
        dailyRiskLimitUsd: Number(refs.automationMappingDailyRisk.value),
        priority: Number(refs.automationMappingPriority.value),
        enabled: refs.automationMappingEnabled.checked
      })
    });
    resetAutomationMappingForm();
    setHint(refs.automationMappingResult, "商品映射已按站点当前 /config 能力保存");
    await refreshAutomationConsole();
  } catch (error) {
    setHint(refs.automationMappingResult, error.message);
  } finally {
    setButtonBusy(submitButton, false);
  }
});

refs.automationMappingCancel?.addEventListener("click", resetAutomationMappingForm);
refs.automationMappingRefresh?.addEventListener("click", () => {
  refreshAutomationConsole().catch((error) => setHint(refs.automationMappingResult, error.message));
});
refs.automationExecutionRefresh?.addEventListener("click", () => {
  refreshAutomationConsole().catch((error) => setHint(refs.automationExecutionResult, error.message));
});

refs.membershipFulfillmentSettingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/membership-fulfillment/settings", {
      method: "PATCH",
      body: JSON.stringify({
        appId: refs.membershipAppId.value.trim() || null,
        appSecret: refs.membershipAppSecret.value.trim(),
        clearAppSecret: refs.membershipClearAppSecret.checked,
        webhookSecret: refs.membershipWebhookSecret.value.trim(),
		clearWebhookSecret: refs.membershipClearWebhookSecret.checked,
		gptToken: refs.membershipGptToken.value.trim(),
		clearGptToken: refs.membershipClearGptToken.checked
      })
    });
    setHint(refs.membershipFulfillmentSettingsResult, "会员履约基础凭据已加密保存；付款 Gate 仍保持锁定");
    await refreshMembershipFulfillmentConsole();
  } catch (error) {
    setHint(refs.membershipFulfillmentSettingsResult, error.message);
  }
});

refs.membershipEfunCardSettingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  setButtonBusy(submitButton, true, "保存中...");
  try {
    await api("/api/admin/membership-card-platforms/efuncard", {
      method: "PUT",
      body: JSON.stringify({
        baseUrl: refs.membershipEfunCardBaseUrl.value.trim(),
        apiKey: refs.membershipEfunCardApiKey.value.trim(),
        clearCredential: refs.membershipEfunCardClearApiKey.checked,
        enabled: refs.membershipEfunCardEnabled.checked,
        priority: Number(refs.membershipEfunCardPriority.value)
      })
    });
    setHint(refs.membershipEfunCardSettingsResult, "EfunCard 配置已加密保存；连接身份变化后需重新初始化该卡台库存");
    await refreshMembershipFulfillmentConsole();
  } catch (error) {
    setHint(refs.membershipEfunCardSettingsResult, error.message);
  } finally {
    setButtonBusy(submitButton, false);
  }
});

refs.membershipFulfillmentRefresh?.addEventListener("click", () => {
  refreshMembershipFulfillmentConsole().catch((error) => setHint(refs.membershipFulfillmentSettingsResult, error.message));
});

refs.membershipFulfillmentListRefresh?.addEventListener("click", async () => {
  setButtonBusy(refs.membershipFulfillmentListRefresh, true, "刷新中...");
  try {
    await refreshMembershipFulfillments();
    setHint(refs.membershipFulfillmentListResult, `会员履约列表已刷新：${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setHint(refs.membershipFulfillmentListResult, error.message);
  } finally {
    setButtonBusy(refs.membershipFulfillmentListRefresh, false);
  }
});

refs.membershipFulfillmentBackfillForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  const orderNo = refs.membershipFulfillmentBackfillOrder.value.trim();
  if (!window.confirm(`确认只为订单 ${orderNo} 补建会员履约？此操作不会开卡、充值或付款。`)) return;
  setButtonBusy(submitButton, true, "补建中...");
  try {
    const payload = await api("/api/admin/membership-fulfillments/backfill", {
      method: "POST",
      body: JSON.stringify({ orderNo })
    });
    refs.membershipFulfillmentBackfillForm.reset();
    await refreshMembershipFulfillments();
    setHint(
      refs.membershipFulfillmentListResult,
	  payload.enrolled
		? "会员履约已纳入，Worker 将继续检查订阅状态"
		: "该订单已经纳入会员自动化"
    );
  } catch (error) {
    setHint(refs.membershipFulfillmentListResult, error.message);
  } finally {
    setButtonBusy(submitButton, false);
  }
});

refs.membershipInventoryInitialize?.addEventListener("click", async () => {
  if (!window.confirm("确认开始完整卡片库存初始化？完成前不会启用自动选卡。")) return;
  setButtonBusy(refs.membershipInventoryInitialize, true, "启动中...");
  try {
    await api("/api/admin/membership-inventory/initialize", {
      method: "POST",
      body: JSON.stringify({ providerKey: refs.membershipInventoryPlatform.value })
    });
    setHint(refs.membershipCardListResult, "库存初始化已启动，Worker 将断点处理全部卡片");
    await refreshMembershipFulfillmentConsole();
  } catch (error) {
    setHint(refs.membershipCardListResult, error.message);
  } finally {
    setButtonBusy(refs.membershipInventoryInitialize, false);
  }
});

refs.membershipInventoryRefresh?.addEventListener("click", async () => {
  setButtonBusy(refs.membershipInventoryRefresh, true, "启动中...");
  try {
    await api("/api/admin/membership-inventory/refresh", {
      method: "POST",
      body: JSON.stringify({ providerKey: refs.membershipInventoryPlatform.value })
    });
    setHint(refs.membershipCardListResult, "库存、余额、交易和行情刷新已启动");
    await refreshMembershipFulfillmentConsole();
  } catch (error) {
    setHint(refs.membershipCardListResult, error.message);
  } finally {
    setButtonBusy(refs.membershipInventoryRefresh, false);
  }
});

refs.membershipInventoryPlatform?.addEventListener("change", () => {
  refreshMembershipFulfillmentConsole().catch((error) => setHint(refs.membershipCardListResult, error.message));
});

refs.membershipCardListRefresh?.addEventListener("click", async () => {
  setButtonBusy(refs.membershipCardListRefresh, true, "刷新中...");
  try {
    await refreshMembershipFulfillmentConsole();
  } catch (error) {
    setHint(refs.membershipCardListResult, error.message);
  } finally {
    setButtonBusy(refs.membershipCardListRefresh, false);
  }
});

refs.membershipPriceContractForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const minAmount = Number(refs.membershipPriceContractMin.value);
  const maxAmount = Number(refs.membershipPriceContractMax.value);
  try {
    await api("/api/admin/checkout-price-contracts", {
      method: "POST",
      body: JSON.stringify({
        tier: refs.membershipPriceContractTier.value,
        minAmount,
        maxAmount
      })
    });
    refs.membershipPriceContractMin.value = "";
    refs.membershipPriceContractMax.value = "";
    setHint(refs.membershipPriceContractResult, "价格契约草稿已新增，请核对后手动激活");
    await refreshMembershipPriceContracts();
  } catch (error) {
    setHint(refs.membershipPriceContractResult, error.message);
  }
});

refs.membershipProductPolicyRefresh?.addEventListener("click", async () => {
  setButtonBusy(refs.membershipProductPolicyRefresh, true, "刷新中...");
  try {
    await refreshMembershipProductPolicies();
  } catch (error) {
    setHint(refs.membershipProductPolicyResult, error.message);
  } finally {
    setButtonBusy(refs.membershipProductPolicyRefresh, false);
  }
});

refs.membershipNoChargeForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/checkout-validation-runs", {
      method: "POST",
      body: JSON.stringify({
        siteId: refs.membershipNoChargeSite.value.trim(),
        productId: refs.membershipNoChargeProduct.value.trim(),
        tier: refs.membershipNoChargeTier.value,
        adapterVersion: refs.membershipNoChargeAdapter.value.trim(),
        priceContractId: refs.membershipNoChargeContract.value.trim(),
        facts: {
          originRecognized: refs.membershipNoChargeOrigin.checked,
          routeRecognized: refs.membershipNoChargeRoute.checked,
          planRecognized: refs.membershipNoChargePlan.checked,
          currency: "PHP",
          displayedAmount: Number(refs.membershipNoChargeAmount.value),
          requiredFieldsRecognized: refs.membershipNoChargeFields.checked,
          allowedControlRecognized: refs.membershipNoChargeControl.checked,
          cardMaterialRequested: false,
          progressionActivated: false,
          finalSubmitActivated: false
        }
      })
    });
    setHint(refs.membershipNoChargeResult, payload.item?.status === "passed" ? "无扣款白名单检查已记录为通过" : "验证记录已保存，但存在未通过检查");
    await refreshMembershipNoChargeRuns();
  } catch (error) {
    setHint(refs.membershipNoChargeResult, error.message);
  }
});

refs.membershipCircuitRefresh?.addEventListener("click", async () => {
  setButtonBusy(refs.membershipCircuitRefresh, true, "刷新中...");
  try {
    await refreshMembershipCircuits();
  } catch (error) {
    setHint(refs.membershipCircuitResult, error.message);
  } finally {
    setButtonBusy(refs.membershipCircuitRefresh, false);
  }
});

refs.membershipRolloutModeForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  setButtonBusy(submitButton, true, "验密更新中...");
  try {
    const payload = await api("/api/admin/membership-fulfillment/rollout-mode", {
      method: "POST",
      body: JSON.stringify({
        mode: refs.membershipRolloutMode.value,
        credentials: {
          username: refs.membershipRolloutAdminUsername.value.trim(),
          password: refs.membershipRolloutAdminPassword.value
        }
      })
    });
    refs.membershipRolloutConfirm.checked = false;
    setHint(refs.membershipRolloutResult, `Rollout Gate 已更新为 ${payload.item?.mode || refs.membershipRolloutMode.value}`);
    await refreshMembershipFulfillmentConsole();
  } catch (error) {
    setHint(refs.membershipRolloutResult, membershipAdminError(error));
  } finally {
    refs.membershipRolloutAdminPassword.value = "";
    setButtonBusy(submitButton, false);
  }
});

refs.membershipCanaryStartForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  const fulfillmentId = refs.membershipCanaryStartFulfillment.value.trim();
  setButtonBusy(submitButton, true, "验密准备中...");
  try {
    const payload = await api(`/api/admin/membership-fulfillments/${encodeURIComponent(fulfillmentId)}/start-canary`, {
      method: "POST",
      body: JSON.stringify({
        credentials: {
          username: refs.membershipCanaryStartAdminUsername.value.trim(),
          password: refs.membershipCanaryStartAdminPassword.value
        }
      })
    });
    refs.membershipCanaryStartForm.reset();
    setHint(refs.membershipCanaryStartResult, `${payload.item?.targetTier || "该订单"} Canary 已准备，等待资金编排与页面阶段批准`);
    await refreshMembershipFulfillments();
  } catch (error) {
    setHint(refs.membershipCanaryStartResult, membershipAdminError(error));
  } finally {
    refs.membershipCanaryStartAdminPassword.value = "";
    setButtonBusy(submitButton, false);
  }
});

refs.membershipCanaryRefresh?.addEventListener("click", async () => {
  setButtonBusy(refs.membershipCanaryRefresh, true, "刷新中...");
  try {
    await Promise.all([refreshMembershipFulfillments(), refreshMembershipCanaryAuthorizations()]);
    setHint(refs.membershipCanaryResult, "Canary 页面准备态与批准记录已刷新");
  } catch (error) {
    setHint(refs.membershipCanaryResult, membershipAdminError(error));
  } finally {
    setButtonBusy(refs.membershipCanaryRefresh, false);
  }
});

refs.membershipCanaryForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  setButtonBusy(submitButton, true, "验密批准中...");
  try {
    const payload = await api("/api/admin/live-canary-authorizations", {
      method: "POST",
      body: JSON.stringify({
        fulfillmentId: refs.membershipCanaryFulfillment.value.trim(),
        stage: refs.membershipCanaryStage.value,
        cardId: refs.membershipCanaryCard.value.trim(),
        fundingBudgetUsd: Number(refs.membershipCanaryBudget.value),
        priceContractId: refs.membershipCanaryContract.value.trim(),
        adapterVersion: refs.membershipCanaryAdapter.value.trim(),
        pageFingerprint: refs.membershipCanaryFingerprint.value.trim().toLowerCase(),
        credentials: {
          username: refs.membershipCanaryAdminUsername.value.trim(),
          password: refs.membershipCanaryAdminPassword.value
        }
      })
    });
    refs.membershipCanaryForm.reset();
    refs.membershipCanarySubmit.disabled = true;
    setHint(refs.membershipCanaryResult, `当前阶段已单次批准，有效至 ${payload.item?.expiresAt || "15 分钟后"}`);
    await Promise.all([refreshMembershipFulfillments(), refreshMembershipCanaryAuthorizations()]);
  } catch (error) {
    setHint(refs.membershipCanaryResult, membershipAdminError(error));
  } finally {
    refs.membershipCanaryAdminPassword.value = "";
    setButtonBusy(submitButton, false);
    refs.membershipCanarySubmit.disabled = !refs.membershipCanaryFingerprint.value;
  }
});

refs.membershipQualificationRefresh?.addEventListener("click", async () => {
  setButtonBusy(refs.membershipQualificationRefresh, true, "刷新中...");
  try {
    await refreshMembershipQualifications();
    setHint(refs.membershipQualificationResult, "分层上线资格已刷新");
  } catch (error) {
    setHint(refs.membershipQualificationResult, membershipAdminError(error));
  } finally {
    setButtonBusy(refs.membershipQualificationRefresh, false);
  }
});

refs.membershipQualificationForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  setButtonBusy(submitButton, true, "权威检查中...");
  try {
    const payload = await api("/api/admin/tier-rollout-qualifications", {
      method: "POST",
      body: JSON.stringify({
        fulfillmentId: refs.membershipQualificationFulfillment.value.trim(),
        adapterVersion: refs.membershipQualificationAdapter.value.trim(),
        adapterPath: refs.membershipQualificationPath.value.trim(),
        priceContractId: refs.membershipQualificationContract.value.trim()
      })
    });
    refs.membershipQualificationForm.reset();
    setHint(refs.membershipQualificationResult, `${payload.item?.tier || "该层级"} 精确版本已取得上线资格；尚未启用自动范围`);
    await refreshMembershipQualifications();
  } catch (error) {
    setHint(refs.membershipQualificationResult, membershipAdminError(error));
  } finally {
    setButtonBusy(submitButton, false);
  }
});

refs.membershipAutomaticScopeRefresh?.addEventListener("click", async () => {
  setButtonBusy(refs.membershipAutomaticScopeRefresh, true, "刷新中...");
  try {
    await refreshMembershipAutomaticScopes();
    setHint(refs.membershipAutomaticScopeResult, "Automatic Checkout 精确范围已刷新");
  } catch (error) {
    setHint(refs.membershipAutomaticScopeResult, membershipAdminError(error));
  } finally {
    setButtonBusy(refs.membershipAutomaticScopeRefresh, false);
  }
});

refs.membershipAutomaticScopeForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  setButtonBusy(submitButton, true, "验密创建中...");
  try {
    await api("/api/admin/automatic-checkout-scopes", {
      method: "POST",
      body: JSON.stringify({
        siteId: refs.membershipAutomaticSite.value.trim(),
        productId: refs.membershipAutomaticProduct.value.trim(),
        tier: refs.membershipAutomaticTier.value,
        adapterVersion: refs.membershipAutomaticAdapter.value.trim(),
        priceContractId: refs.membershipAutomaticContract.value.trim(),
        dailyOrderLimit: Number(refs.membershipAutomaticOrderLimit.value),
        dailyRiskLimitUsd: Number(refs.membershipAutomaticRiskLimit.value),
        credentials: {
          username: refs.membershipAutomaticAdminUsername.value.trim(),
          password: refs.membershipAutomaticAdminPassword.value
        }
      })
    });
    refs.membershipAutomaticScopeForm.reset();
    setHint(refs.membershipAutomaticScopeResult, "精确自动范围已创建，初始额度固定为每日 1 单");
    await refreshMembershipAutomaticScopes();
  } catch (error) {
    setHint(refs.membershipAutomaticScopeResult, membershipAdminError(error));
  } finally {
    refs.membershipAutomaticAdminPassword.value = "";
    setButtonBusy(submitButton, false);
  }
});

refs.membershipAutomaticRevisionForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  const id = refs.membershipAutomaticRevisionId.value.trim();
  if (!id) return setHint(refs.membershipAutomaticScopeResult, "请先从范围列表载入一个修订基线");
  setButtonBusy(submitButton, true, "验密修订中...");
  try {
    const adapterVersion = refs.membershipAutomaticRevisionAdapter.value.trim();
    const priceContractId = refs.membershipAutomaticRevisionContract.value.trim();
    await api(`/api/admin/automatic-checkout-scopes/${encodeURIComponent(id)}/increase-limits`, {
      method: "POST",
      body: JSON.stringify({
        dailyOrderLimit: Number(refs.membershipAutomaticRevisionOrderLimit.value),
        dailyRiskLimitUsd: Number(refs.membershipAutomaticRevisionRiskLimit.value),
        ...(adapterVersion ? { adapterVersion } : {}),
        ...(priceContractId ? { priceContractId } : {}),
        credentials: {
          username: refs.membershipAutomaticRevisionAdminUsername.value.trim(),
          password: refs.membershipAutomaticRevisionAdminPassword.value
        }
      })
    });
    refs.membershipAutomaticRevisionForm.reset();
    setHint(refs.membershipAutomaticScopeResult, "新修订已创建；原活动修订不再接收新订单");
    await refreshMembershipAutomaticScopes();
  } catch (error) {
    setHint(refs.membershipAutomaticScopeResult, membershipAdminError(error));
  } finally {
    refs.membershipAutomaticRevisionAdminPassword.value = "";
    setButtonBusy(submitButton, false);
  }
});

refs.membershipInterventionRefresh?.addEventListener("click", async () => {
  setButtonBusy(refs.membershipInterventionRefresh, true, "刷新中...");
  try {
    await refreshMembershipInterventions();
    setHint(refs.membershipInterventionResult, "人工介入提醒已刷新");
  } catch (error) {
    setHint(refs.membershipInterventionResult, membershipAdminError(error));
  } finally {
    setButtonBusy(refs.membershipInterventionRefresh, false);
  }
});

refs.membershipCompensationForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter;
  const fulfillmentId = refs.membershipCompensationFulfillment.value.trim();
  setButtonBusy(submitButton, true, "追加中...");
  try {
    await api(`/api/admin/membership-fulfillments/${encodeURIComponent(fulfillmentId)}/compensations`, {
      method: "POST",
      body: JSON.stringify({
        resolutionType: refs.membershipCompensationType.value,
        evidenceReference: refs.membershipCompensationEvidence.value.trim()
      })
    });
    refs.membershipCompensationForm.reset();
    setHint(refs.membershipCompensationResult, "外部补偿结果已追加；没有调用任何资金或卡片接口");
    await refreshMembershipFulfillments();
  } catch (error) {
    setHint(refs.membershipCompensationResult, membershipAdminError(error));
  } finally {
    setButtonBusy(submitButton, false);
  }
});

refs.storeSettingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/store-fulfillment/settings", {
      method: "PUT",
      body: JSON.stringify({
        baseUrl: refs.storeBaseUrl.value.trim(),
        adminUsername: refs.storeAdminUsername.value.trim(),
        adminPassword: refs.storeAdminPassword.value,
        enabled: refs.storeEnabled.value === "true",
        pollIntervalSeconds: Number(refs.storePollInterval.value || 30)
      })
    });
    setHint(refs.storeSettingsResult, "商城连接配置已保存");
    await refreshStoreSettings();
  } catch (error) {
    setHint(refs.storeSettingsResult, error.message);
  }
});

refs.storeTestBtn?.addEventListener("click", async () => {
  setButtonBusy(refs.storeTestBtn, true, "测试中...");
  try {
    await api("/api/admin/store-fulfillment/test", { method: "POST", body: JSON.stringify({}) });
    setHint(refs.storeSettingsResult, "Dujiao 登录和订单读取测试成功");
  } catch (error) {
    setHint(refs.storeSettingsResult, error.message);
  } finally {
    setButtonBusy(refs.storeTestBtn, false);
    await refreshStoreSettings().catch(() => {});
  }
});

refs.storeMappingForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = refs.storeMappingId.value;
  try {
    await api(id
      ? `/api/admin/store-fulfillment/mappings/${encodeURIComponent(id)}`
      : "/api/admin/store-fulfillment/mappings", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify({
        productId: refs.storeProductId.value.trim(),
        skuId: refs.storeSkuId.value.trim() || "0",
        productTitle: refs.storeProductTitle.value.trim(),
        manualType: refs.storeManualType.value,
        fulfillmentKind: refs.storeFulfillmentKind.value,
        spacexPlan: refs.storeFulfillmentKind.value === "spacex_cdk" ? refs.storeSpaceXPlan.value : null,
        siteId: refs.storeSiteId.value,
        prefix: refs.storePrefix.value.trim(),
        enabled: refs.storeMappingEnabled.value === "true"
      })
    });
    setHint(refs.storeMappingResult, id ? "商品映射已更新" : "商品映射已创建");
    resetStoreMappingForm();
    await refreshStoreMappings();
  } catch (error) {
    setHint(refs.storeMappingResult, error.message);
  }
});

refs.storeFulfillmentKind?.addEventListener("change", syncStoreMappingKind);
refs.storeSpaceXPlan?.addEventListener("change", syncStoreMappingKind);
refs.storeMappingCancelBtn?.addEventListener("click", resetStoreMappingForm);
refs.storeMappingsRefreshBtn?.addEventListener("click", () => refreshStoreMappings().catch((error) => setHint(refs.storeMappingResult, error.message)));
refs.storeTasksRefreshBtn?.addEventListener("click", () => refreshStoreTasks().catch((error) => setHint(refs.storeTaskResult, error.message)));
refs.storeTaskListRefreshBtn?.addEventListener("click", async () => {
  setButtonBusy(refs.storeTaskListRefreshBtn, true, "刷新中...");
  try {
    await refreshStoreTasks();
    setHint(refs.storeTaskResult, `商城交付列表已刷新：${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setHint(refs.storeTaskResult, error.message);
  } finally {
    setButtonBusy(refs.storeTaskListRefreshBtn, false);
  }
});

refs.spaceXCdkSettingsForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/spacex-cdk/settings", {
      method: "PUT",
      body: JSON.stringify({
        enabled: refs.spaceXCdkEnabled.value === "true",
        rolloutPlan: refs.spaceXCdkRolloutPlan.value,
        baseUrl: refs.spaceXCdkBaseUrl.value.trim(),
        apiKey: refs.spaceXCdkApiKey.value,
        webhookSecret: refs.spaceXCdkWebhookSecret.value,
        unlimitedFundingPolicy: refs.spaceXCdkUnlimitedFundingPolicy.value,
        adminUsername: refs.spaceXCdkAdminUsername.value.trim(),
        adminPassword: refs.spaceXCdkAdminPassword.value
      })
    });
    refs.spaceXCdkAdminPassword.value = "";
    setHint(refs.spaceXCdkSettingsResult, "SpaceX CDK 配置已保存；保存动作本身未发起发码");
    await refreshSpaceXCdkSettings();
  } catch (error) {
    setHint(refs.spaceXCdkSettingsResult, error.message);
  }
});

refs.spaceXCdkTestBtn?.addEventListener("click", async () => {
  setButtonBusy(refs.spaceXCdkTestBtn, true, "测试中...");
  try {
    const payload = await api("/api/admin/spacex-cdk/test", { method: "POST", body: JSON.stringify({}) });
    setHint(refs.spaceXCdkSettingsResult, `只读余额测试成功：${(Number(payload.funding.balanceMinor) / 100).toFixed(2)} ${payload.funding.currency}`);
    await refreshSpaceXCdkSettings();
  } catch (error) {
    setHint(refs.spaceXCdkSettingsResult, error.message);
  } finally {
    setButtonBusy(refs.spaceXCdkTestBtn, false);
  }
});

refs.spaceXCdkInventoryRefresh?.addEventListener("click", () => refreshSpaceXCdkInventory().catch((error) => setHint(refs.spaceXCdkSettingsResult, error.message)));
refs.spaceXCdkActivationsRefresh?.addEventListener("click", () => refreshSpaceXCdkActivations().catch((error) => setHint(refs.spaceXCdkSettingsResult, error.message)));
refs.storeTaskStatusFilter?.addEventListener("change", () => refreshStoreTasks().catch((error) => setHint(refs.storeTaskResult, error.message)));
refs.storeTaskQuery?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") refreshStoreTasks().catch((error) => setHint(refs.storeTaskResult, error.message));
});
refs.storeManualType?.addEventListener("change", () => {
  if (!refs.storePrefix.value.trim() || ["PLUS", "x5", "x20"].includes(refs.storePrefix.value.trim())) {
    refs.storePrefix.value = refs.storeManualType.value;
  }
});
refs.cdkeySearchBtn?.addEventListener("click", () => refreshCdkeys().catch((error) => alert(error.message)));
refs.cdkeyFilterKeyword?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") refreshCdkeys().catch((error) => alert(error.message));
});

refs.singleCdkeyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/cdkeys/create", {
      method: "POST",
      body: JSON.stringify({
        sourceKey: document.querySelector("#single-source-key").value.trim(),
        siteId: refs.singleSite.value,
        prefix: document.querySelector("#single-prefix").value.trim(),
        note: "",
        emailToken: refs.singleEmailToken.value.trim(),
        processingMode: refs.singleProcessingMode.value,
        manualType: refs.singleManualType.value
      })
    });
    refs.singleCdkeyForm.reset();
    refs.singleSite.value = "site_preset_meimei_site";
    refs.singleProcessingMode.value = "auto";
    refs.singleManualType.value = "PLUS";
    setHint(
      refs.singleCdkeyResult,
      payload.mode === "manual"
        ? `已生成人工处理卡密: ${payload.publicKey}（${payload.manualType || "-"}）`
        : payload.mode === "support"
        ? `已生成接码卡密: ${payload.publicKey}`
        : `已添加普通卡密: ${payload.publicKey}`
    );
    await refreshAll();
  } catch (error) {
    setHint(refs.singleCdkeyResult, error.message);
  }
});

refs.batchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/batches/import", {
      method: "POST",
      body: JSON.stringify({
        name: document.querySelector("#batch-name").value.trim(),
        prefix: document.querySelector("#batch-prefix").value.trim(),
        siteId: refs.batchSite.value,
        importType: refs.batchImportType.value,
        rawKeys: document.querySelector("#batch-raw-keys").value,
        note: ""
      })
    });
    refs.batchForm.reset();
    refs.batchSite.value = "site_preset_meimei_site";
    refs.batchImportType.value = "support";
    setHint(
      refs.batchResult,
      `成功导入 ${payload.importedCount} 条（接码专用 ${payload.supportOnlyCount || 0} / 普通 ${payload.normalCount || 0} / 人工处理 ${payload.manualCount || 0}）`
    );
    await refreshAll();
  } catch (error) {
    setHint(refs.batchResult, error.message);
  }
});

refs.cdkeyActionBtn.addEventListener("click", async () => {
  const ids = getCheckedValues(".cdkey-check");
  if (!ids.length) return alert("请先勾选卡密");
  try {
    await api("/api/admin/cdkeys/bulk-action", {
      method: "POST",
      body: JSON.stringify({ ids, action: refs.cdkeyAction.value })
    });
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});

refs.cdkeyExportPublicBtn.addEventListener("click", () => {
  exportPublicKeys();
});

refs.cdkeyExportSourceBtn.addEventListener("click", () => {
  exportSourceKeys();
});

refs.cdkeyExportExcelBtn.addEventListener("click", () => {
  exportCdkeysExcel();
});

refs.retryJobsBtn.addEventListener("click", async () => {
  const ids = getCheckedValues(".job-check");
  if (!ids.length) return alert("请先勾选任务");
  try {
    await api("/api/admin/jobs/retry", {
      method: "POST",
      body: JSON.stringify({ ids })
    });
    await refreshAll();
  } catch (error) {
    alert(error.message);
  }
});

refs.subCardTypeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const editId = refs.subCtEditId.value;
  const body = {
    name: refs.subCtName.value.trim(),
    totalSubscriptions: parseInt(refs.subCtTotal.value, 10) || 0
  };
  if (editId) body.id = editId;

  try {
    await api("/api/admin/subscriptions/card-types", {
      method: "POST",
      body: JSON.stringify(body)
    });
    refs.subCardTypeForm.reset();
    refs.subCtEditId.value = "";
    refs.subCtSubmitBtn.textContent = "添加卡种";
    refs.subCtCancelBtn.classList.add("hidden");
    setHint(refs.subCtResult, editId ? "卡种已更新" : "卡种已添加");
    await refreshSubscriptions();
  } catch (error) {
    setHint(refs.subCtResult, error.message);
  }
});

refs.subCtCancelBtn.addEventListener("click", () => {
  refs.subCardTypeForm.reset();
  refs.subCtEditId.value = "";
  refs.subCtSubmitBtn.textContent = "添加卡种";
  refs.subCtCancelBtn.classList.add("hidden");
  setHint(refs.subCtResult, "");
});

if (refs.notifyMonitorForm) {
  populateNotifyIntervalOptions();
  ensureRuleEmptyHint();
  syncNotifyModeUi();

  refs.notifyAddRule?.addEventListener("click", () => addRuleRow());
  refs.notifyMonitorType?.addEventListener("change", syncNotifyModeUi);

  refs.notifySettingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const payload = await api("/api/admin/notifications/settings", {
        method: "PATCH",
        body: JSON.stringify({ globalFeishuWebhook: refs.notifyGlobalWebhook.value.trim() })
      });
      setStatusMessage(
        refs.notifySettingsResult,
        payload.globalFeishuWebhook ? "已保存全局 Webhook" : "已清空全局 Webhook",
        "success"
      );
    } catch (error) {
      setStatusMessage(refs.notifySettingsResult, `保存失败：${error.message}`, "error");
    }
  });

  refs.notifyTestGlobalWebhook?.addEventListener("click", async () => {
    const webhookUrl = refs.notifyGlobalWebhook.value.trim();
    if (!webhookUrl) {
      setStatusMessage(refs.notifySettingsResult, "请先填写飞书 Webhook 地址", "error");
      return;
    }
    try {
      setStatusMessage(refs.notifySettingsResult, "正在发送飞书测试消息，请稍候...", "info");
      setButtonBusy(refs.notifyTestGlobalWebhook, true, "发送中...");
      const payload = await api("/api/admin/notifications/test-feishu", {
        method: "POST",
        body: JSON.stringify({ webhookUrl })
      });
      setStatusMessage(
        refs.notifySettingsResult,
        payload.ok
          ? "飞书测试消息已发送，请到群里查收。"
          : `飞书返回失败：${payload.text || payload.status}`,
        payload.ok ? "success" : "error"
      );
    } catch (error) {
      setStatusMessage(refs.notifySettingsResult, `发送失败：${error.message}`, "error");
    } finally {
      setButtonBusy(refs.notifyTestGlobalWebhook, false);
    }
  });

  refs.notifyFormCancel?.addEventListener("click", () => {
    resetNotifyForm();
  });

  refs.notifyRefreshBtn?.addEventListener("click", () => {
    refreshNotifications().catch((error) => setHint(refs.notifyFormResult, error.message));
  });

  refs.notifyTestRunBtn?.addEventListener("click", async () => {
    const id = refs.notifyEditId.value;
    if (!id) {
      setStatusMessage(refs.notifyFormResult, "请先保存监听后再测试", "error");
      return;
    }
    await testNotifyMonitor(id);
  });

  refs.notifyMonitorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const editId = refs.notifyEditId.value;
    const rules = collectRules();
    const watchFieldsRaw = refs.notifyWatchFields.value || "";
    const watchFields = watchFieldsRaw
      .split(/[\n,;\s]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const intervalSeconds = Number(refs.notifyInterval.value);

    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 3600) {
      setStatusMessage(refs.notifyFormResult, "轮询间隔必须在 1-3600 秒之间", "error");
      return;
    }

    const headersValue = refs.notifyHeaders.value.trim();
    if (headersValue) {
      try {
        const parsed = JSON.parse(headersValue);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Headers 必须是 JSON 对象");
        }
      } catch (error) {
        setStatusMessage(refs.notifyFormResult, `Headers 不是合法 JSON：${error.message}`, "error");
        return;
      }
    }
    const bodyValue = refs.notifyBody.value.trim();
    if (bodyValue) {
      try {
        JSON.parse(bodyValue);
      } catch (error) {
        const isLikelyRawText = bodyValue.includes("=") || bodyValue.includes("&");
        if (!isLikelyRawText) {
          setStatusMessage(refs.notifyFormResult, `Body 不是合法 JSON：${error.message}`, "error");
          return;
        }
      }
    }

    const payload = {
      name: refs.notifyName.value.trim(),
      monitorType: refs.notifyMonitorType.value,
      enabled: refs.notifyEnabled.value === "1",
      requestUrl: refs.notifyUrl.value.trim(),
      httpMethod: refs.notifyMethod.value,
      browserPageUrl: refs.notifyBrowserPageUrl.value.trim(),
      browserReadySelector: refs.notifyBrowserReadySelector.value.trim(),
      browserWaitMs: Math.max(1000, Math.min(60000, Number(refs.notifyBrowserWaitMs.value) || 10000)),
      headersJson: headersValue,
      bodyJson: bodyValue,
      intervalSeconds,
      timeoutSeconds: Math.max(1, Math.min(120, Number(refs.notifyTimeout.value) || 15)),
      watchFields,
      rules,
      feishuWebhookOverride: refs.notifyWebhookOverride.value.trim(),
      notifyTitle: refs.notifyTitle.value.trim(),
      cooldownSeconds: Math.max(0, Math.min(86400, Number(refs.notifyCooldown.value) || 0))
    };
    if (editId) payload.id = editId;

    if (payload.monitorType === "browser" && !payload.browserPageUrl) {
      setStatusMessage(refs.notifyFormResult, "浏览器模式必须填写页面 URL", "error");
      return;
    }

    try {
      const result = await api("/api/admin/notifications/monitors", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      resetNotifyForm();
      await refreshNotifications();
      setStatusMessage(refs.notifyFormResult, editId ? "监听已更新" : `监听已创建：${result.id}`, "success");
    } catch (error) {
      setStatusMessage(refs.notifyFormResult, `保存失败：${error.message}`, "error");
    }
  });
}

refs.smsSiteForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/sms/sites", {
      method: "POST",
      body: JSON.stringify({
        name: refs.smsSiteName.value.trim(),
        slug: refs.smsSiteSlug.value.trim(),
        inventorySource: refs.smsSiteInventorySource.value,
        apiKey: refs.smsSiteApiKey.value.trim(),
        appId: refs.smsSiteAppId.value.trim(),
        cardType: Number(refs.smsSiteCardType.value || 1),
        expiry: Number(refs.smsSiteExpiry.value || 0),
        note: refs.smsSiteNote.value.trim()
      })
    });
    refs.smsSiteForm.reset();
    setHint(refs.smsSiteResult, "接码站点已创建");
    await refreshSmsConsole();
  } catch (error) {
    setHint(refs.smsSiteResult, error.message);
  }
});

refs.smsCardForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/sms/cards", {
      method: "POST",
      body: JSON.stringify({
        siteId: refs.smsCardSite.value,
        prefix: refs.smsCardPrefix.value.trim(),
        count: Number(refs.smsCardCount.value || 1),
        note: refs.smsCardNote.value.trim()
      })
    });
    refs.smsCardForm.reset();
    setHint(refs.smsCardResult, `已生成 ${payload.cards.length} 张接码卡密`);
    await refreshSmsConsole();
  } catch (error) {
    setHint(refs.smsCardResult, error.message);
  }
});

// ── SMS Batch Import Form ──
refs.smsBatchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/sms/import", {
      method: "POST",
      body: JSON.stringify({
        batchName: document.querySelector("#sms-batch-name").value.trim(),
        prefix: document.querySelector("#sms-batch-prefix").value.trim(),
        content: document.querySelector("#sms-batch-content").value
      })
    });
    refs.smsBatchForm.reset();
    setHint(refs.smsBatchResult, `成功导入 ${payload.importedCount} 条静态库存记录`);
    setTimeout(() => {
      if (refs.smsBatchResult.textContent.startsWith("成功导入")) {
        setHint(refs.smsBatchResult, "");
      }
    }, 5000);
    await refreshSmsEntries();
  } catch (error) {
    setHint(refs.smsBatchResult, error.message);
  }
});

// ── SMS Single Add Form ──
refs.smsSingleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = await api("/api/admin/sms/entries", {
      method: "POST",
      body: JSON.stringify({
        phone: document.querySelector("#sms-single-phone").value.trim(),
        smsUrl: document.querySelector("#sms-single-url").value.trim(),
        prefix: document.querySelector("#sms-single-prefix").value.trim()
      })
    });
    refs.smsSingleForm.reset();
    setHint(refs.smsSingleResult, `已添加库存卡密: ${payload.publicKey}`);
    await refreshSmsEntries();
  } catch (error) {
    setHint(refs.smsSingleResult, error.message);
  }
});

// ── SMS Copy Public Keys ──
async function copySmsPublicKeys() {
  const checkboxes = Array.from(document.querySelectorAll(".sms-check")).filter((cb) => cb.checked);
  if (!checkboxes.length) {
    setHint(refs.smsBatchResult, "请先选择记录");
    return;
  }
  const keys = checkboxes.map((cb) => cb.dataset.publicKey);
  const text = keys.map((k) => String(k).trimEnd()).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    setHint(refs.smsBatchResult, `已复制 ${keys.length} 条卡密`);
    setTimeout(() => {
      if (refs.smsBatchResult.textContent.startsWith("已复制")) {
        setHint(refs.smsBatchResult, "");
      }
    }, 3000);
  } catch (_) {
    setHint(refs.smsBatchResult, "复制失败：剪贴板写入被拒绝");
  }
}

refs.smsCopyKeysBtn.addEventListener("click", () => {
  copySmsPublicKeys();
});

// ── SMS Copy Info ──
async function copySmsInfo() {
  const checkboxes = Array.from(document.querySelectorAll(".sms-check")).filter((cb) => cb.checked);
  if (!checkboxes.length) {
    setHint(refs.smsBatchResult, "请先选择记录");
    return;
  }
  const lines = checkboxes.map((cb) => {
    const phone = cb.dataset.phone || "";
    const smsUrl = cb.dataset.smsUrl || "";
    return `${phone}----${smsUrl}`;
  });
  const text = lines.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    setHint(refs.smsBatchResult, `已复制 ${lines.length} 条接码信息`);
    setTimeout(() => {
      if (refs.smsBatchResult.textContent.startsWith("已复制")) {
        setHint(refs.smsBatchResult, "");
      }
    }, 3000);
  } catch (_) {
    setHint(refs.smsBatchResult, "复制失败：剪贴板写入被拒绝");
  }
}

refs.smsCopyInfoBtn.addEventListener("click", () => {
  copySmsInfo();
});

// ── SMS Export Excel ──
function generateSmsExcelFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `sms_export_${stamp}.xlsx`;
}

async function exportSmsExcel() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  setButtonBusy(refs.smsExportExcelBtn, true, "导出中...");
  try {
    const payload = await api("/api/admin/sms/export", { signal: controller.signal });
    clearTimeout(timeout);

    if (!payload.items || !payload.items.length) {
      setHint(refs.smsBatchResult, "无数据可导出");
      return;
    }

    const rows = payload.items.map((item) => ({
      "卡密": item.publicKey || "",
      "手机号": item.phone || "",
      "接码网址": item.smsUrl || "",
      "前缀": item.prefix || "",
      "批次": item.batchName || "",
      "状态": item.status || "",
      "创建时间": item.createdAt || ""
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "接码数据");
    XLSX.writeFile(wb, generateSmsExcelFilename());
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      setHint(refs.smsBatchResult, "导出失败：请求超时");
    } else {
      setHint(refs.smsBatchResult, `导出失败：${error.message}`);
    }
  } finally {
    setButtonBusy(refs.smsExportExcelBtn, false);
  }
}

refs.smsExportExcelBtn.addEventListener("click", () => {
  exportSmsExcel();
});

// ── SMS Batch Status Update ──
async function updateSmsStatus() {
  const checkboxes = Array.from(document.querySelectorAll(".sms-check")).filter((cb) => cb.checked);
  if (!checkboxes.length) {
    setHint(refs.smsBatchResult, "请先选择记录");
    return;
  }
  const ids = checkboxes.map((cb) => cb.value);
  const status = refs.smsAction.value;
  try {
    const payload = await api("/api/admin/sms/entries/status", {
      method: "PATCH",
      body: JSON.stringify({ ids, status })
    });
    setHint(refs.smsBatchResult, `已更新 ${payload.updatedCount} 条记录`);
    await refreshSmsEntries();
  } catch (error) {
    setHint(refs.smsBatchResult, error.message);
  }
}

async function updateSmsCardStatus() {
  const ids = Array.from(document.querySelectorAll(".sms-card-check"))
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
  if (!ids.length) {
    setHint(refs.smsCardResult, "请先选择接码卡密");
    return;
  }
  try {
    const payload = await api("/api/admin/sms/cards/status", {
      method: "PATCH",
      body: JSON.stringify({ ids, status: refs.smsCardAction.value })
    });
    setHint(refs.smsCardResult, `已更新 ${payload.updatedCount} 张接码卡密`);
    await refreshSmsCards();
  } catch (error) {
    setHint(refs.smsCardResult, error.message);
  }
}

refs.smsActionBtn.addEventListener("click", () => {
  updateSmsStatus();
});

refs.smsCardActionBtn?.addEventListener("click", () => {
  updateSmsCardStatus();
});

// ── Quota Import Form ──
if (refs.quotaApiKeyForm) {
  refs.quotaApiKeyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const apiKey = refs.quotaApiKeyInput?.value.trim() || "";
    if (!apiKey) {
      setHint(refs.quotaApiKeyResult, "请输入 API 密钥");
      return;
    }
    try {
      setHint(refs.quotaApiKeyResult, "正在验证并保存...");
      const payload = await api("/api/admin/quota/cards/import", {
        method: "POST",
        body: JSON.stringify({ cards: [apiKey] })
      });
      if ((payload.successCount ?? 0) < 1) {
        const reason = payload.failures?.[0]?.reason || "API 密钥验证失败";
        setHint(refs.quotaApiKeyResult, `保存失败：${reason}`);
        renderQuotaImportResults(payload);
        return;
      }
      setHint(refs.quotaApiKeyResult, "API 密钥已保存");
      refs.quotaApiKeyInput.value = "";
      renderQuotaImportResults(payload);
      await refreshQuotaDashboard();
      await refreshQuotaSourceCards();
    } catch (error) {
      setHint(refs.quotaApiKeyResult, `保存失败：${error.message}`);
    }
  });
}

if (refs.quotaImportForm) {
  refs.quotaImportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw = refs.quotaImportCodes.value.trim();
    if (!raw) {
      setHint(refs.quotaImportResult, "请输入至少一张卡密");
      return;
    }
    const codes = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (codes.length === 0) {
      setHint(refs.quotaImportResult, "请输入至少一张卡密");
      return;
    }
    if (codes.length > 100) {
      setHint(refs.quotaImportResult, "单次最多导入 100 张卡密");
      return;
    }
    try {
      setHint(refs.quotaImportResult, "正在导入，请稍候...");
      const payload = await api("/api/admin/quota/cards/import", {
        method: "POST",
        body: JSON.stringify({ cards: codes })
      });
      setHint(refs.quotaImportResult, `导入完成：成功 ${payload.successCount ?? 0}，失败 ${payload.failedCount ?? 0}`);
      renderQuotaImportResults(payload);
      refs.quotaImportCodes.value = "";
      await refreshQuotaDashboard();
    } catch (error) {
      setHint(refs.quotaImportResult, `导入失败：${error.message}`);
    }
  });
}

// ── Quota Settings Form ──
async function loadQuotaSettings() {
  if (!refs.quotaLowStockThreshold) return;
  try {
    const payload = await api("/api/admin/quota/settings");
    refs.quotaLowStockThreshold.value = payload.lowStockThreshold ?? 5;
  } catch (_) {
    // silently ignore load errors
  }
}

if (refs.quotaSettingsForm) {
  refs.quotaSettingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = parseInt(refs.quotaLowStockThreshold.value, 10);
    if (!Number.isInteger(value) || value < 1) {
      setHint(refs.quotaSettingsResult, "低库存阈值必须为正整数（>= 1）");
      return;
    }
    try {
      await api("/api/admin/quota/settings", {
        method: "PATCH",
        body: JSON.stringify({ low_stock_threshold: value })
      });
      setHint(refs.quotaSettingsResult, "设置已保存");
    } catch (error) {
      setHint(refs.quotaSettingsResult, `保存失败：${error.message}`);
    }
  });
}

// ── Quota Sub-Card Create Form ──
if (refs.quotaSubCardForm) {
  refs.quotaSubCardForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const quota = parseInt(refs.quotaSubCardQuota.value, 10);
    const count = parseInt(refs.quotaSubCardCount.value, 10);
    if (!quota || quota < 1 || quota > 999999) {
      setHint(refs.quotaSubCardResult, "额度必须为 1 ~ 999999 的正整数");
      return;
    }
    if (!count || count < 1 || count > 100) {
      setHint(refs.quotaSubCardResult, "数量必须为 1 ~ 100 的正整数");
      return;
    }
    try {
      setHint(refs.quotaSubCardResult, "正在创建，请稍候...");
      const payload = await api("/api/admin/quota/sub-cards", {
        method: "POST",
        body: JSON.stringify({ quota, count })
      });
      setHint(refs.quotaSubCardResult, `成功创建 ${payload.createdCount ?? count} 张子卡密`);
      refs.quotaSubCardForm.reset();
      await refreshQuotaSubCards(1);
      await refreshQuotaDashboard();
    } catch (error) {
      setHint(refs.quotaSubCardResult, `创建失败：${error.message}`);
    }
  });
}

// ── Quota Sub-Card Refresh Button ──
if (refs.quotaSubCardRefreshBtn) {
  refs.quotaSubCardRefreshBtn.addEventListener("click", () => {
    refreshQuotaSubCards().catch((error) => {
      if (refs.quotaSubCardList) {
        refs.quotaSubCardList.innerHTML = `<p class="hint centered">刷新失败：${escapeHtml(error.message)}</p>`;
      }
    });
  });
}

if (refs.quotaSubCardStatus) {
  refs.quotaSubCardStatus.addEventListener("change", () => {
    quotaSubCardState.status = refs.quotaSubCardStatus.value;
    refreshQuotaSubCards(1).catch((error) => {
      if (refs.quotaSubCardList) {
        refs.quotaSubCardList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
      }
    });
  });
}

if (refs.quotaSubCardPageSize) {
  refs.quotaSubCardPageSize.addEventListener("change", () => {
    quotaSubCardState.pageSize = Number(refs.quotaSubCardPageSize.value || DEFAULT_TABLE_PAGE_SIZE);
    refreshQuotaSubCards(1).catch((error) => {
      if (refs.quotaSubCardList) {
        refs.quotaSubCardList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
      }
    });
  });
}

if (refs.quotaSubCardPagination) {
  refs.quotaSubCardPagination.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quota-sub-page]");
    if (!button || button.disabled) return;
    refreshQuotaSubCards(Number(button.dataset.quotaSubPage)).catch((error) => {
      if (refs.quotaSubCardList) {
        refs.quotaSubCardList.innerHTML = `<p class="hint centered">加载失败：${escapeHtml(error.message)}</p>`;
      }
    });
  });
}

// ── Quota Sub-Card Batch Actions ──
function getSelectedSubCards() {
  const checks = document.querySelectorAll(".quota-sub-check:checked");
  return Array.from(checks).map(el => ({
    id: el.value,
    code: el.dataset.code,
    total: Number(el.dataset.total),
    used: Number(el.dataset.used),
    status: el.dataset.status
  }));
}

if (refs.quotaSubCardCopyBtn) {
  refs.quotaSubCardCopyBtn.addEventListener("click", () => {
    let selected = getSelectedSubCards();
    if (!selected.length) {
      // If none selected, copy all visible
      const allChecks = document.querySelectorAll(".quota-sub-check");
      selected = Array.from(allChecks).map(el => ({
        id: el.value,
        code: el.dataset.code,
        total: Number(el.dataset.total),
        used: Number(el.dataset.used),
        status: el.dataset.status
      }));
    }
    if (!selected.length) return;
    const text = selected.map(s => s.code).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setStatusMessage(refs.quotaSubCardResult, `已复制 ${selected.length} 张卡密编码`, "success");
    }).catch(() => {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setStatusMessage(refs.quotaSubCardResult, `已复制 ${selected.length} 张卡密编码`, "success");
    });
  });
}

if (refs.quotaSubCardExportBtn) {
  refs.quotaSubCardExportBtn.addEventListener("click", () => {
    let selected = getSelectedSubCards();
    if (!selected.length) {
      const allChecks = document.querySelectorAll(".quota-sub-check");
      selected = Array.from(allChecks).map(el => ({
        id: el.value,
        code: el.dataset.code,
        total: Number(el.dataset.total),
        used: Number(el.dataset.used),
        status: el.dataset.status
      }));
    }
    if (!selected.length) return;
    const lines = ["编码,总额度,已用额度,剩余,状态"];
    for (const s of selected) {
      lines.push(`${s.code},${s.total},${s.used},${s.total - s.used},${s.status}`);
    }
    const csv = lines.join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quota-sub-cards-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage(refs.quotaSubCardResult, `已导出 ${selected.length} 张子卡密`, "success");
  });
}

// ── Quota Source-Card Refresh + Merge Buttons ──
const _verifiedZeroCardIds = new Set();

if (refs.quotaSourceCardsRefreshBtn) {
  refs.quotaSourceCardsRefreshBtn.addEventListener("click", async () => {
    refs.quotaSourceCardsRefreshBtn.disabled = true;
    refs.quotaSourceCardsRefreshBtn.textContent = "同步中...";
    try {
      const payload = await api("/api/admin/quota/cards?status=active&pageSize=100");
      const items = payload.cards || payload.items || [];
      for (const item of items) {
        if (_verifiedZeroCardIds.has(item.id)) continue;
        try {
          const result = await api("/api/admin/quota/cards/verify", {
            method: "POST",
            body: JSON.stringify({ cardId: item.id }),
          });
          if (result.ok && result.remaining === 0) {
            _verifiedZeroCardIds.add(item.id);
          }
        } catch {
          // Ignore individual verify failures
        }
      }
      await refreshQuotaSourceCards();
    } catch {
      await refreshQuotaSourceCards().catch(() => {});
    } finally {
      refs.quotaSourceCardsRefreshBtn.disabled = false;
      refs.quotaSourceCardsRefreshBtn.textContent = "刷新";
    }
  });
}
if (refs.quotaSourceCardsExportBtn) {
  refs.quotaSourceCardsExportBtn.addEventListener("click", () => {
    exportQuotaSourceCards(false).catch(() => {});
  });
}
if (refs.quotaSourceCardsExportAllBtn) {
  refs.quotaSourceCardsExportAllBtn.addEventListener("click", () => {
    exportQuotaSourceCards(true).catch(() => {});
  });
}
if (refs.quotaSourceCardsMergeBtn) {
  refs.quotaSourceCardsMergeBtn.addEventListener("click", () => {
    handleQuotaSourceCardsMerge().catch(() => {});
  });
}

// ── Quota Sub-Card Detail Close Button ──
if (refs.quotaSubCardDetailClose) {
  refs.quotaSubCardDetailClose.addEventListener("click", () => {
    if (refs.quotaSubCardDetailCard) {
      refs.quotaSubCardDetailCard.classList.add("hidden");
    }
  });
}

// ── 5sim Panel Functions ──
let fivesimSitesCache = [];

function formatBalance(value) {
  const num = Number(value);
  if (isNaN(num)) return "- RUB";
  return num.toFixed(2) + " RUB";
}

function maskPhone(phone) {
  const str = String(phone || "");
  if (str.length <= 4) return "*".repeat(str.length);
  return "*".repeat(str.length - 4) + str.slice(-4);
}

function maskApiKeyDisplay(val) {
  if (!val || val.length <= 12) return val || "";
  return val.slice(0, 6) + "..." + val.slice(-4);
}

function renderFivesimStatus(status) {
  const colors = {
    waiting: "yellow",
    code_received: "blue",
    completed: "green",
    cancelled: "grey",
    error: "red"
  };
  const color = colors[status] || "grey";
  return `<span class="table-badge status-${color}">${escapeHtml(status || "-")}</span>`;
}

function populateFivesimSiteSelect(sites) {
  fivesimSitesCache = sites || [];
  if (!refs.fivesimSiteSelect) return;

  if (!fivesimSitesCache.length) {
    refs.fivesimSiteSelect.innerHTML = `<option value="">暂无站点</option>`;
    if (refs.fivesimBalanceBtn) refs.fivesimBalanceBtn.disabled = true;
    return;
  }

  if (refs.fivesimBalanceBtn) refs.fivesimBalanceBtn.disabled = false;

  const options = fivesimSitesCache.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`);
  refs.fivesimSiteSelect.innerHTML = options.join("");

  // Default to first site with sms_provider
  const defaultSite = fivesimSitesCache.find((s) => s.sms_provider) || fivesimSitesCache[0];
  if (defaultSite) {
    refs.fivesimSiteSelect.value = defaultSite.id;
    loadFivesimSiteConfig(defaultSite);
  }
}

function loadFivesimSiteConfig(site) {
  if (!refs.fivesimConfigForm || !site) return;
  const el = (id) => document.querySelector(id);
  el("#fivesim-sms-provider").value = site.sms_provider || "";
  el("#fivesim-sms-api-key").value = "";
  el("#fivesim-sms-api-key").placeholder = maskApiKeyDisplay(site.sms_api_key) || "API Key（已加密存储）";
  el("#fivesim-sms-country").value = site.sms_country || "";
  el("#fivesim-sms-service").value = site.sms_service || "";
  el("#fivesim-sms-operator").value = site.sms_operator || "";
  el("#fivesim-sms-poll-interval").value = site.sms_poll_interval_ms || "";
  el("#fivesim-sms-poll-timeout").value = site.sms_poll_timeout_ms || "";
  el("#fivesim-sms-phone-tpl").value = site.sms_submit_phone_template || "";
  el("#fivesim-sms-code-tpl").value = site.sms_submit_code_template || "";
}

async function queryFivesimBalance() {
  const siteId = refs.fivesimSiteSelect?.value;
  if (!siteId) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  setButtonBusy(refs.fivesimBalanceBtn, true, "查询中...");
  setStatusMessage(refs.fivesimBalanceResult, "");

  try {
    const payload = await api(`/api/admin/5sim/balance?siteId=${siteId}`, { signal: controller.signal });
    if (refs.fivesimBalanceDisplay) {
      refs.fivesimBalanceDisplay.innerHTML = `<article class="stat"><span>余额</span><strong>${formatBalance(payload.balance)}</strong></article>`;
    }
  } catch (error) {
    setStatusMessage(refs.fivesimBalanceResult, error.message, "error");
  } finally {
    clearTimeout(timeout);
    setButtonBusy(refs.fivesimBalanceBtn, false);
  }
}

// ── 5sim Panel Event Wiring ──
if (refs.fivesimBalanceBtn) {
  refs.fivesimBalanceBtn.addEventListener("click", () => {
    queryFivesimBalance().catch(() => {});
  });
}

if (refs.fivesimSiteSelect) {
  refs.fivesimSiteSelect.addEventListener("change", () => {
    const siteId = refs.fivesimSiteSelect.value;
    const site = fivesimSitesCache.find((s) => s.id === siteId);
    if (site) loadFivesimSiteConfig(site);
  });
}

async function saveFivesimConfig() {
  const siteId = refs.fivesimSiteSelect?.value;
  if (!siteId) return;

  const fields = {};
  const provider = document.querySelector("#fivesim-sms-provider").value.trim();
  const apiKey = document.querySelector("#fivesim-sms-api-key").value.trim();
  const country = document.querySelector("#fivesim-sms-country").value.trim();
  const service = document.querySelector("#fivesim-sms-service").value.trim();
  const operator = document.querySelector("#fivesim-sms-operator").value.trim();
  const pollInterval = document.querySelector("#fivesim-sms-poll-interval").value.trim();
  const pollTimeout = document.querySelector("#fivesim-sms-poll-timeout").value.trim();
  const phoneTpl = document.querySelector("#fivesim-sms-phone-tpl").value.trim();
  const codeTpl = document.querySelector("#fivesim-sms-code-tpl").value.trim();

  if (provider) fields.sms_provider = provider;
  if (apiKey) fields.sms_api_key = apiKey;
  if (country) fields.sms_country = country;
  if (service) fields.sms_service = service;
  if (operator) fields.sms_operator = operator;
  if (pollInterval) fields.sms_poll_interval_ms = parseInt(pollInterval, 10);
  if (pollTimeout) fields.sms_poll_timeout_ms = parseInt(pollTimeout, 10);
  if (phoneTpl) fields.sms_submit_phone_template = phoneTpl;
  if (codeTpl) fields.sms_submit_code_template = codeTpl;

  if (Object.keys(fields).length === 0) {
    setStatusMessage(refs.fivesimConfigResult, "请至少填写一个字段", "error");
    return;
  }

  try {
    await api(`/api/admin/sites/${siteId}/sms-config`, {
      method: "PATCH",
      body: JSON.stringify(fields)
    });
    setStatusMessage(refs.fivesimConfigResult, "配置已保存", "success");
  } catch (error) {
    setStatusMessage(refs.fivesimConfigResult, error.message, "error");
  }
}

if (refs.fivesimConfigForm) {
  refs.fivesimConfigForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveFivesimConfig().catch(() => {});
  });
}

async function refreshFivesimJobs() {
  if (!refs.fivesimJobList) return;
  setButtonBusy(refs.fivesimJobsRefreshBtn, true, "刷新中...");
  setStatusMessage(refs.fivesimJobsResult, "");

  try {
    const payload = await api("/api/admin/5sim/jobs");
    renderTable(refs.fivesimJobList, [
      { label: "订单号", render: (item) => escapeHtml(item.order_no || "-") },
      { label: "站点", render: (item) => escapeHtml(item.site_name || "-") },
      { label: "5sim 状态", render: (item) => renderFivesimStatus(item.fivesimStatus) },
      { label: "手机号", render: (item) => escapeHtml(maskPhone(item.fivesimPhone)) },
      { label: "验证码", render: (item) => escapeHtml(item.fivesimCode || "-") },
      { label: "轮询次数", render: (item) => item.fivesimPollCount ?? "-" },
      { label: "更新时间", render: (item) => escapeHtml(item.updated_at || "-") }
    ], payload.items || [], "暂无 5sim 任务");
  } catch (error) {
    setStatusMessage(refs.fivesimJobsResult, error.message, "error");
  } finally {
    setButtonBusy(refs.fivesimJobsRefreshBtn, false);
  }
}

if (refs.fivesimJobsRefreshBtn) {
  refs.fivesimJobsRefreshBtn.addEventListener("click", () => {
    refreshFivesimJobs().catch(() => {});
  });
}

async function refreshFivesimTab() {
  try {
    const payload = await api("/api/admin/sites");
    populateFivesimSiteSelect(payload.items || []);
  } catch (_) {
    // silently ignore
  }
  refreshFivesimJobs().catch(() => {});
}

refs.refreshBtn.addEventListener("click", () => {
  refreshAll().catch((error) => alert(error.message));
});

refs.logoutBtn.addEventListener("click", () => {
  clearToken();
  stopAutoRefresh();
  stopUpdatePolling();
  setAuthState(false);
});

setupModuleSubtabs();
switchTab(currentTab);

if (getToken()) {
  setAuthState(true, "admin");
  startAutoRefresh();
  refreshAll().catch(() => {
    clearToken();
    setAuthState(false);
  });
} else {
  setAuthState(false);
}
