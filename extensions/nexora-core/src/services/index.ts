/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { BackendClient, getBackendClient, setApiKeyHeaderProvider } from './backendClient';
export type { BackendConfig } from './backendClient';
export { SettingsService, getSettingsService } from './settingsService';
export type { NexoraPreferences, ApiKeyProvider } from './settingsService';
export { NotificationService, getNotificationService } from './notificationService';
