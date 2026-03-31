import { setIcon } from "obsidian";
import { SPEED_MIN, SPEED_MAX, SPEED_STEP, type PlaybackState } from "./types";

/**
 * Floating playback toolbar rendered at the bottom of the markdown view.
 * Uses Obsidian's native Lucide icons for a consistent look.
 *
 * Layout: [Prev] [Play/Pause] [Next]  |  [-] 1.0x [+]  |  3/20  |  [X]
 */
export class Toolbar {
	private containerEl: HTMLElement;
	private el: HTMLElement;

	// Buttons
	private prevBtn: HTMLButtonElement;
	private playBtn: HTMLButtonElement;
	private nextBtn: HTMLButtonElement;
	private slowerBtn: HTMLButtonElement;
	private fasterBtn: HTMLButtonElement;
	private closeBtn: HTMLButtonElement;

	// Displays
	private speedDisplay: HTMLSpanElement;
	private progressDisplay: HTMLSpanElement;

	// Callbacks
	onPlay?: () => void;
	onPause?: () => void;
	onPrev?: () => void;
	onNext?: () => void;
	onClose?: () => void;
	onSpeedChange?: (speed: number) => void;

	private currentSpeed: number;
	private _state: PlaybackState = "idle";

	constructor(parentEl: HTMLElement, initialSpeed: number) {
		this.containerEl = parentEl;
		this.currentSpeed = initialSpeed;

		this.el = document.createElement("div");
		this.el.className = "tts-reader-toolbar";

		const controls = this.el.createDiv({ cls: "tts-reader-controls" });

		// --- Playback controls ---
		this.prevBtn = this.createButton(controls, "skip-back", "Previous sentence", () =>
			this.onPrev?.(),
		);
		this.playBtn = this.createButton(controls, "play", "Play", () =>
			this.handlePlayPause(),
		);
		this.nextBtn = this.createButton(controls, "skip-forward", "Next sentence", () =>
			this.onNext?.(),
		);

		controls.createDiv({ cls: "tts-reader-separator" });

		// --- Speed controls ---
		this.slowerBtn = this.createButton(controls, "minus", "Slower", () =>
			this.adjustSpeed(-SPEED_STEP),
		);

		this.speedDisplay = controls.createSpan({
			cls: "tts-reader-speed",
			text: this.formatSpeed(initialSpeed),
		});

		this.fasterBtn = this.createButton(controls, "plus", "Faster", () =>
			this.adjustSpeed(SPEED_STEP),
		);

		controls.createDiv({ cls: "tts-reader-separator" });

		// --- Progress ---
		this.progressDisplay = controls.createSpan({
			cls: "tts-reader-progress",
			text: "0 / 0",
		});

		controls.createDiv({ cls: "tts-reader-separator" });

		// --- Close button ---
		this.closeBtn = this.createButton(controls, "x", "Close", () =>
			this.onClose?.(),
		);

		this.containerEl.appendChild(this.el);
	}

	updateState(state: PlaybackState): void {
		this._state = state;
		if (state === "playing") {
			setIcon(this.playBtn, "pause");
			this.playBtn.ariaLabel = "Pause";
			this.playBtn.title = "Pause";
		} else {
			setIcon(this.playBtn, "play");
			this.playBtn.ariaLabel = state === "paused" ? "Resume" : "Play";
			this.playBtn.title = state === "paused" ? "Resume" : "Play";
		}
	}

	updateProgress(current: number, total: number): void {
		this.progressDisplay.textContent = `${current + 1}\u2009/\u2009${total}`;
	}

	updateSpeed(speed: number): void {
		this.currentSpeed = speed;
		this.speedDisplay.textContent = this.formatSpeed(speed);
		this.slowerBtn.disabled = speed <= SPEED_MIN;
		this.fasterBtn.disabled = speed >= SPEED_MAX;
	}

	destroy(): void {
		this.el.remove();
	}

	// --- Internal ---

	private createButton(
		parent: HTMLElement,
		iconId: string,
		label: string,
		onClick: () => void,
	): HTMLButtonElement {
		const btn = document.createElement("button");
		btn.className = "tts-reader-btn";
		btn.ariaLabel = label;
		btn.title = label;
		setIcon(btn, iconId);
		btn.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			onClick();
		});
		parent.appendChild(btn);
		return btn;
	}

	private handlePlayPause(): void {
		if (this._state === "playing") {
			this.onPause?.();
		} else {
			this.onPlay?.();
		}
	}

	private adjustSpeed(delta: number): void {
		let newSpeed = Math.round((this.currentSpeed + delta) * 100) / 100;
		newSpeed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, newSpeed));
		if (newSpeed !== this.currentSpeed) {
			this.currentSpeed = newSpeed;
			this.speedDisplay.textContent = this.formatSpeed(newSpeed);
			this.slowerBtn.disabled = newSpeed <= SPEED_MIN;
			this.fasterBtn.disabled = newSpeed >= SPEED_MAX;
			this.onSpeedChange?.(newSpeed);
		}
	}

	private formatSpeed(speed: number): string {
		return speed % 1 === 0 ? `${speed}.0\u00D7` : `${speed}\u00D7`;
	}
}
