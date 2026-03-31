import { SPEED_MIN, SPEED_MAX, SPEED_STEP, type PlaybackState } from "./types";

/**
 * Floating playback toolbar rendered at the bottom of the markdown view.
 *
 * Layout: [Prev] [Play/Pause] [Next] [Stop]  |  [-] 1.0x [+]  |  3/20
 *
 * All buttons have 44px minimum tap targets for mobile usability.
 */
export class Toolbar {
	private containerEl: HTMLElement;
	private el: HTMLElement;

	// Buttons
	private prevBtn: HTMLButtonElement;
	private playBtn: HTMLButtonElement;
	private nextBtn: HTMLButtonElement;
	private stopBtn: HTMLButtonElement;
	private slowerBtn: HTMLButtonElement;
	private fasterBtn: HTMLButtonElement;

	// Displays
	private speedDisplay: HTMLSpanElement;
	private progressDisplay: HTMLSpanElement;

	// Callbacks
	onPlay?: () => void;
	onPause?: () => void;
	onStop?: () => void;
	onPrev?: () => void;
	onNext?: () => void;
	onSpeedChange?: (speed: number) => void;

	private currentSpeed: number;
	private _state: PlaybackState = "idle";

	constructor(parentEl: HTMLElement, initialSpeed: number) {
		this.containerEl = parentEl;
		this.currentSpeed = initialSpeed;

		// Build the toolbar DOM
		this.el = document.createElement("div");
		this.el.className = "tts-reader-toolbar";

		// --- Playback controls ---
		const controls = this.el.createDiv({ cls: "tts-reader-controls" });

		this.prevBtn = this.createButton(controls, "\u23EE", "Previous sentence", () =>
			this.onPrev?.(),
		);
		this.playBtn = this.createButton(controls, "\u25B6", "Play", () =>
			this.handlePlayPause(),
		);
		this.nextBtn = this.createButton(controls, "\u23ED", "Next sentence", () =>
			this.onNext?.(),
		);
		this.stopBtn = this.createButton(controls, "\u23F9", "Stop", () =>
			this.onStop?.(),
		);

		// --- Separator ---
		controls.createDiv({ cls: "tts-reader-separator" });

		// --- Speed controls ---
		this.slowerBtn = this.createButton(
			controls,
			"\u2212",
			"Slower",
			() => this.adjustSpeed(-SPEED_STEP),
		);

		this.speedDisplay = controls.createSpan({
			cls: "tts-reader-speed",
			text: this.formatSpeed(initialSpeed),
		});

		this.fasterBtn = this.createButton(
			controls,
			"+",
			"Faster",
			() => this.adjustSpeed(SPEED_STEP),
		);

		// --- Separator ---
		controls.createDiv({ cls: "tts-reader-separator" });

		// --- Progress ---
		this.progressDisplay = controls.createSpan({
			cls: "tts-reader-progress",
			text: "0 / 0",
		});

		// Attach to parent
		this.containerEl.appendChild(this.el);
	}

	/** Update the toolbar to reflect current playback state. */
	updateState(state: PlaybackState): void {
		this._state = state;
		switch (state) {
			case "playing":
				this.playBtn.textContent = "\u23F8";
				this.playBtn.ariaLabel = "Pause";
				break;
			case "paused":
				this.playBtn.textContent = "\u25B6";
				this.playBtn.ariaLabel = "Resume";
				break;
			case "idle":
				this.playBtn.textContent = "\u25B6";
				this.playBtn.ariaLabel = "Play";
				break;
		}
	}

	/** Update the sentence progress display. */
	updateProgress(current: number, total: number): void {
		this.progressDisplay.textContent = `${current + 1}\u2009/\u2009${total}`;
	}

	/** Update the speed display (e.g., after external speed change). */
	updateSpeed(speed: number): void {
		this.currentSpeed = speed;
		this.speedDisplay.textContent = this.formatSpeed(speed);
		this.slowerBtn.disabled = speed <= SPEED_MIN;
		this.fasterBtn.disabled = speed >= SPEED_MAX;
	}

	/** Remove the toolbar from the DOM. */
	destroy(): void {
		this.el.remove();
	}

	// --- Internal ---

	private createButton(
		parent: HTMLElement,
		text: string,
		label: string,
		onClick: () => void,
	): HTMLButtonElement {
		const btn = document.createElement("button");
		btn.className = "tts-reader-btn";
		btn.textContent = text;
		btn.ariaLabel = label;
		btn.title = label;
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
		let newSpeed =
			Math.round((this.currentSpeed + delta) * 100) / 100;
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
