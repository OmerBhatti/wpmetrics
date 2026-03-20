import React, { useEffect, useMemo, useRef, useState } from 'react';

const NAV_ITEMS = [
	{ id: 'home', label: 'Home' },
	{ id: 'productivity', label: 'Productivity' },
	{ id: 'appBreakdown', label: 'App Break Down' },
	{ id: 'hotKeys', label: 'Hot Keys' },
	{ id: 'help', label: 'Help' },
];

const emptySnapshot = {
	trackingPaused: false,
	liveWpm: 0,
	today: { date: '', chars: 0, words: 0 },
	week: { chars: 0, words: 0 },
	goal: { words: 1000, progressPercent: 0 },
	appBreakdown: [],
	productiveHours: [],
	topHour: null,
	keyHeatmap: [],
	runtime: {
		globalCapturePreferred: true,
		globalCaptureAvailable: false,
		globalCaptureActive: false,
		globalCaptureReason: 'Initializing',
		captureMode: 'window',
	},
};

function formatHour(hour) {
	const suffix = hour >= 12 ? 'PM' : 'AM';
	const normalized = hour % 12 === 0 ? 12 : hour % 12;
	return `${normalized}:00 ${suffix}`;
}

function getTypingApi() {
	if (typeof window === 'undefined') return null;
	return window.typing || null;
}

export default function App() {
	const typing = getTypingApi();
	const [activePage, setActivePage] = useState('home');
	const [snapshot, setSnapshot] = useState(emptySnapshot);
	const [goalInput, setGoalInput] = useState('1000');
	const [loaded, setLoaded] = useState(false);
	const [clearingProgress, setClearingProgress] = useState(false);
	const [milestoneToast, setMilestoneToast] = useState(null);
	const globalCaptureActiveRef = useRef(false);
	const toastTimerRef = useRef(null);

	useEffect(() => {
		globalCaptureActiveRef.current = Boolean(snapshot.runtime?.globalCaptureActive);
	}, [snapshot.runtime?.globalCaptureActive]);

	useEffect(() => {
		if (!typing) return undefined;

		let mounted = true;
		typing.getSnapshot().then(data => {
			if (!mounted || !data) return;
			setSnapshot(data);
			setGoalInput(String(data.goal.words));
			setLoaded(true);
		});

		const unsubscribe = typing.onSnapshot(data => {
			if (!data) return;
			setSnapshot(data);
		});

		return () => {
			mounted = false;
			unsubscribe();
		};
	}, [typing]);

	useEffect(() => {
		if (!typing) return undefined;

		const onKeyDown = event => {
			if (globalCaptureActiveRef.current) return;
			if (event.isComposing) return;
			if (event.metaKey || event.ctrlKey || event.altKey) return;

			typing.sendKeypress({
				key: event.key,
				code: event.code,
				timestamp: Date.now(),
				appName: 'WPMetrics',
			});
		};

		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [typing]);

	useEffect(() => {
		if (!typing || typeof typing.onMilestone !== 'function') return undefined;

		const unsubscribe = typing.onMilestone(payload => {
			if (!payload) return;
			setMilestoneToast({
				title: payload.title || 'Milestone reached',
				body: payload.body || '',
				level: payload.level || 'half',
			});
			if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
			toastTimerRef.current = setTimeout(() => {
				setMilestoneToast(null);m
				toastTimerRef.current = null;
			}, 5500);
		});

		return () => {
			if (toastTimerRef.current) {
				clearTimeout(toastTimerRef.current);
				toastTimerRef.current = null;
			}
			unsubscribe();
		};
	}, [typing]);

	const topKeys = useMemo(() => snapshot.keyHeatmap.slice(0, 24), [snapshot.keyHeatmap]);
	const topApps = useMemo(() => snapshot.appBreakdown.slice(0, 8), [snapshot.appBreakdown]);
	const topHours = useMemo(
		() => [...snapshot.productiveHours].sort((a, b) => b.chars - a.chars).slice(0, 10),
		[snapshot.productiveHours],
	);

	const maxAppChars = topApps[0]?.chars || 1;
	const maxHourChars = topHours[0]?.chars || 1;

	const handleGoalSave = async () => {
		if (!typing) return;
		const value = Number(goalInput);
		if (!Number.isFinite(value) || value <= 0) return;
		const updated = await typing.setGoal(value);
		if (updated) setSnapshot(updated);
	};

	const handlePauseToggle = async () => {
		if (!typing) return;
		const updated = await typing.setPaused(!snapshot.trackingPaused);
		if (updated) setSnapshot(updated);
	};

	const handleCaptureModeToggle = async () => {
		if (!typing) return;
		const updated = await typing.setGlobalCapturePreferred(!snapshot.runtime.globalCapturePreferred);
		if (updated) setSnapshot(updated);
	};

	const handleClearProgress = async () => {
		if (!typing || clearingProgress) return;
		const shouldClear = window.confirm(
			'Clear all typing progress data? This will remove your stats history and cannot be undone.',
		);
		if (!shouldClear) return;

		setClearingProgress(true);
		try {
			const updated = await typing.clearProgress();
			if (updated) setSnapshot(updated);
		} finally {
			setClearingProgress(false);
		}
	};

	function renderPageHeader({ title, subtitle, metricLabel, metricValue }) {
		return (
			<section className="hero">
				<div>
					<h1>{title}</h1>
					<p className="muted-light">{subtitle}</p>
				</div>
				<div className="live-pill">
					<span>{metricLabel}</span>
					<strong>{metricValue}</strong>
				</div>
			</section>
		);
	}

	function renderHome() {
		return (
			<>
				{renderPageHeader({
					title: 'Home',
					subtitle: `Capture source: ${
						snapshot.runtime.captureMode === 'global' ? 'Global' : 'Window Fallback'
					}`,
					metricLabel: 'Live WPM',
					metricValue: Math.round(snapshot.liveWpm),
				})}

				<section className="cards">
					<article className="card">
						<h2>Today</h2>
						<p className="metric">{snapshot.today.words} words</p>
						<p className="muted">{snapshot.today.chars} characters</p>
					</article>
					<article className="card">
						<h2>Last 7 Days</h2>
						<p className="metric">{snapshot.week.words} words</p>
						<p className="muted">{snapshot.week.chars} characters</p>
					</article>
					<article className="card">
						<h2>Top Hour</h2>
						<p className="metric">{snapshot.topHour ? formatHour(snapshot.topHour.hour) : 'No data'}</p>
						<p className="muted">
							{snapshot.topHour ? `${snapshot.topHour.words} words` : 'Start typing to generate'}
						</p>
					</article>
				</section>

				<section className="cards cards-1">
					<article className="card">
						<div className="row-head">
							<h2>Daily Goal</h2>
							<button className="button-secondary" onClick={handlePauseToggle}>
								{snapshot.trackingPaused ? 'Resume' : 'Pause'}
							</button>
						</div>
						<div className="goal-row">
							<input
								type="number"
								min="1"
								value={goalInput}
								onChange={event => setGoalInput(event.target.value)}
							/>
							<button className="button-primary" onClick={handleGoalSave}>
								Save Goal
							</button>
						</div>
						<div className="progress-track">
							<div className="progress-fill" style={{ width: `${snapshot.goal.progressPercent}%` }} />
						</div>
						<p className="muted">
							{snapshot.goal.progressPercent}% of {snapshot.goal.words} words
						</p>
					</article>
				</section>

				<section className="cards cards-1">
					<article className="card">
						<div className="row-head">
							<h2>Capture Engine</h2>
							<button className="button-secondary" onClick={handleCaptureModeToggle}>
								{snapshot.runtime.globalCapturePreferred ? 'Disable Global' : 'Enable Global'}
							</button>
						</div>
						<p className="muted">
							Preferred: {snapshot.runtime.globalCapturePreferred ? 'Global' : 'Window'}
						</p>
						<p className="muted">
							Status:{' '}
							{snapshot.runtime.globalCaptureActive
								? 'Global capture active'
								: snapshot.runtime.globalCaptureReason}
						</p>
					</article>
				</section>
			</>
		);
	}

	function renderProductivity() {
		const topHourLabel = snapshot.topHour ? formatHour(snapshot.topHour.hour) : '--';
		return (
			<>
				{renderPageHeader({
					title: 'Productivity',
					subtitle: 'Most active typing hours for today.',
					metricLabel: 'Peak Hour',
					metricValue: topHourLabel,
				})}
				<article className="card">
					<h2>Productive Hours</h2>
					{topHours.length === 0 ? <p className="muted">No typing data yet.</p> : null}
					{topHours.map(item => (
						<div className="bar-row" key={item.hour}>
							<div className="bar-label">
								<span>{formatHour(item.hour)}</span>
								<span>{item.words} words</span>
							</div>
							<div className="bar-track">
								<div
									className="bar-fill hour-fill"
									style={{ width: `${(item.chars / maxHourChars) * 100}%` }}
								/>
							</div>
						</div>
					))}
				</article>
			</>
		);
	}

	function renderAppBreakDown() {
		const topAppName = topApps[0]?.name || '--';
		return (
			<>
				{renderPageHeader({
					title: 'App Break Down',
					subtitle: 'Apps where most typing is happening.',
					metricLabel: 'Top App',
					metricValue: topAppName,
				})}
				<article className="card">
					<h2>App Usage</h2>
					{topApps.length === 0 ? <p className="muted">No typing data yet.</p> : null}
					{topApps.map(item => (
						<div className="bar-row" key={item.name}>
							<div className="bar-label">
								<span>{item.name}</span>
								<span>{item.words} words</span>
							</div>
							<div className="bar-track">
								<div className="bar-fill" style={{ width: `${(item.chars / maxAppChars) * 100}%` }} />
							</div>
						</div>
					))}
				</article>
			</>
		);
	}

	function renderHotKeys() {
		const top5Keys =
			topKeys
				.slice(0, 5)
				.map(k => k.key)
				.join(' ') || '--';
		return (
			<>
				{renderPageHeader({
					title: 'Hot Keys',
					subtitle: 'Most frequently pressed keys.',
					metricLabel: 'Top 5 Keys',
					metricValue: top5Keys,
				})}
				<article className="card">
					<h2>Key Heatmap</h2>
					{topKeys.length === 0 ? <p className="muted">No key usage yet.</p> : null}
					<div className="key-grid">
						{topKeys.map(item => (
							<div className="key-box" key={item.key}>
								<span className="key-name">{item.count}</span>
								<strong>{item.key}</strong>
							</div>
						))}
					</div>
				</article>
			</>
		);
	}

	function renderHelpPage() {
		return (
			<>
				{renderPageHeader({
					title: 'Help',
					subtitle: 'How to use this typing tracker.',
					metricLabel: 'Tracking',
					metricValue: snapshot.trackingPaused ? 'Paused' : 'On',
				})}
				<article className="card help-card">
					<h2>Quick Help</h2>
					<p className="muted">1. Keep global capture enabled for system-wide tracking.</p>
					<p className="muted">
						2. If app names are missing, allow permissions for Input Monitoring and System Events.
					</p>
					<p className="muted">3. Use Daily Goal to set your word target and get milestone notifications.</p>
					<p className="muted">4. If needed, disable Global Capture to fall back to window-only tracking.</p>
					<div className="help-actions">
						<button className="button-danger" onClick={handleClearProgress} disabled={clearingProgress}>
							{clearingProgress ? 'Clearing...' : 'Clear All Progress'}
						</button>
					</div>
				</article>
			</>
		);
	}

	function renderPage() {
		if (activePage === 'productivity') return renderProductivity();
		if (activePage === 'appBreakdown') return renderAppBreakDown();
		if (activePage === 'hotKeys') return renderHotKeys();
		if (activePage === 'help') return renderHelpPage();
		return renderHome();
	}

	if (!typing) {
		return (
			<main className="app-shell">
				<section className="content-area">
					<h1>WPMetrics</h1>
					<p>Electron preload API unavailable.</p>
				</section>
			</main>
		);
	}

	return (
		<main className="app-shell">
			<aside className="side-navbar">
				<div className="brand-block">
					<p className="eyebrow">WPMetrics</p>
					<h2>Dashboard</h2>
				</div>
				<nav className="nav-links">
					{NAV_ITEMS.map(item => (
						<button
							key={item.id}
							className={`nav-link ${activePage === item.id ? 'active' : ''}`}
							onClick={() => setActivePage(item.id)}
						>
							{item.label}
						</button>
					))}
				</nav>
				<div className="nav-footer">
					<span>Live WPM</span>
					<strong>{Math.round(snapshot.liveWpm)}</strong>
				</div>
			</aside>

			<section className="content-area">
				{renderPage()}
				{!loaded ? <p className="muted">Loading tracker...</p> : null}
			</section>
			{milestoneToast ? (
				<div
					className={`milestone-toast milestone-toast-${milestoneToast.level}`}
					role="status"
					aria-live="polite"
				>
					<div className="toast-copy">
						<strong>{milestoneToast.title}</strong>
						<p>{milestoneToast.body}</p>
					</div>
					<button className="toast-close" onClick={() => setMilestoneToast(null)}>
						Close
					</button>
				</div>
			) : null}
		</main>
	);
}
