import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '$lib/utils/notifications';

interface MockNotificationInstance {
	onclick: (() => void) | null;
	close: ReturnType<typeof vi.fn>;
}

interface MockNotificationConstructor {
	new (title: string, options?: NotificationOptions): MockNotificationInstance;
	permission: NotificationPermission;
	requestPermission: ReturnType<typeof vi.fn>;
}

const focusSpy = vi.fn();

function setDocumentHidden(hidden: boolean): void {
	Object.defineProperty(document, 'hidden', {
		configurable: true,
		value: hidden,
	});
}

function installNotificationMock(permission: NotificationPermission): {
	Notification: MockNotificationConstructor;
	instances: MockNotificationInstance[];
} {
	const instances: MockNotificationInstance[] = [];

	const NotificationMock = vi.fn(function MockNotification(this: MockNotificationInstance) {
		this.onclick = null;
		this.close = vi.fn();
		instances.push(this);
	}) as unknown as MockNotificationConstructor;

	NotificationMock.permission = permission;
	NotificationMock.requestPermission = vi.fn(async () => NotificationMock.permission);

	Object.defineProperty(globalThis, 'Notification', {
		configurable: true,
		value: NotificationMock,
	});

	return { Notification: NotificationMock, instances };
}

beforeEach(() => {
	setDocumentHidden(false);
	focusSpy.mockReset();
	Object.defineProperty(window, 'focus', {
		configurable: true,
		value: focusSpy,
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('notify', () => {
	it('does nothing when the document is visible', () => {
		setDocumentHidden(false);
		const { Notification } = installNotificationMock('granted');

		notify('Visible tab');

		expect(Notification).not.toHaveBeenCalled();
	});

	it('fires a notification when permission is granted and the tab is hidden', () => {
		setDocumentHidden(true);
		const { Notification, instances } = installNotificationMock('granted');

		notify('Build finished', { body: 'All checks passed', tag: 'build', requireInteraction: true });

		expect(Notification).toHaveBeenCalledWith('Build finished', {
			body: 'All checks passed',
			icon: '/favicon.png',
			tag: 'build',
			requireInteraction: true,
		});
		expect(instances).toHaveLength(1);

		instances[0].onclick?.();
		expect(focusSpy).toHaveBeenCalledTimes(1);
		expect(instances[0].close).toHaveBeenCalledTimes(1);
	});

	it('requests permission lazily and fires when permission is granted', async () => {
		setDocumentHidden(true);
		const { Notification } = installNotificationMock('default');
		Notification.requestPermission.mockResolvedValueOnce('granted');

		notify('Approval needed');
		await vi.waitFor(() => {
			expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
			expect(Notification).toHaveBeenCalledTimes(1);
		});
	});

	it('does nothing when permission is denied', () => {
		setDocumentHidden(true);
		const { Notification } = installNotificationMock('denied');

		notify('Denied');

		expect(Notification.requestPermission).not.toHaveBeenCalled();
		expect(Notification).not.toHaveBeenCalled();
	});
});
