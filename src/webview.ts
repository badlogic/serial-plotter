import { LitElement, PropertyValueMap, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { map } from "lit/directives/map.js";

interface VSCodeApi {
	postMessage(data: ProtocolRequests): void;
}
declare function acquireVsCodeApi(): VSCodeApi;
const vscode = acquireVsCodeApi() as VSCodeApi;

@customElement("port-selector")
class PortSelector extends LitElement {
	@state()
	ports: Port[] = [];

	@state()
	selected: string | undefined;

	@state()
	running: boolean = false;

	@state()
	error?: string;

	plotter?: SerialPlotter;

	createRenderRoot(): Element | ShadowRoot {
		return this;
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.load();
	}

	load() {
		const callback = (ev: { data: ProtocolResponse }) => {
			const message = ev.data;
			if (message.type == "ports-response") {
				const previouslySelected = this.selected;
				this.ports = message.ports;

				if (previouslySelected) {
					const matchingPort = this.ports.find((p) => p.path === previouslySelected);
					if (matchingPort) {
						this.selected = matchingPort.path;
					}
				}
				if (!this.selected) this.selected = this.ports[this.ports.length - 1]?.path ?? undefined;
			}
			if (message.type == "error") {
				if (this.running) {
					this.handleStartStop();
				}
				this.error = "Could not open port or device disconnected";
			}
		};
		window.addEventListener("message", callback);
		vscode.postMessage({ type: "ports" });
	}

	handlePortChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		this.selected = target.value;
	}

	handleRefresh() {
		vscode.postMessage({ type: "ports" });
	}

	handleStartStop() {
		if (!this.selected) return;
		this.error = "";
		this.running = !this.running;
		if (this.running) {
			this.plotter?.remove();
			this.plotter = undefined;
			const baudRate = this.querySelector<HTMLInputElement>("#baud")?.value;
			this.plotter = new SerialPlotter(this.ports.find((p) => p.path === this.selected)!, baudRate ? Number.parseInt(baudRate) : 9600);
			document.body.append(this.plotter);
		} else {
			this.plotter?.stop();
		}
	}

	firstUpdated(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		super.firstUpdated(_changedProperties);
		this.querySelector<HTMLSelectElement>("#baud")!.value = "115200";
	}

	render() {
		return html`
			<div style="display: flex; flex-direction: column; gap: 0.5rem;">
				<div style="display: flex; gap: 0.5rem; justify-items: center; align-items: center;">
					<span>Port</span>
					<select id="port" @change="${this.handlePortChange}" ?disabled="${this.running}">
						${map(
							this.ports,
							(p) => html` <option value="${p.path}" ?selected="${this.selected === p.path}">${p.path + (p.manufacturer ? " - " + p.manufacturer : "")}</option> `
						)}
					</select>
					<div id="refresh" @click="${this.handleRefresh}" ?disabled="${this.running}" style="width: 1rem; height: 1rem;">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
							<path
								d="M5.46257 4.43262C7.21556 2.91688 9.5007 2 12 2C17.5228 2 22 6.47715 22 12C22 14.1361 21.3302 16.1158 20.1892 17.7406L17 12H20C20 7.58172 16.4183 4 12 4C9.84982 4 7.89777 4.84827 6.46023 6.22842L5.46257 4.43262ZM18.5374 19.5674C16.7844 21.0831 14.4993 22 12 22C6.47715 22 2 17.5228 2 12C2 9.86386 2.66979 7.88416 3.8108 6.25944L7 12H4C4 16.4183 7.58172 20 12 20C14.1502 20 16.1022 19.1517 17.5398 17.7716L18.5374 19.5674Z"
							></path>
						</svg>
					</div>
				</div>
				<div style="display: flex; gap: 0.5rem; justify-items: center; align-items: center;">
					<span>Baud Rate</span>
					<select id="baud" ?disabled="${this.running}">
						<option value="110">110</option>
						<option value="300">300</option>
						<option value="600">600</option>
						<option value="1200">1200</option>
						<option value="2400">2400</option>
						<option value="4800">4800</option>
						<option value="9600">9600</option>
						<option value="14400">14400</option>
						<option value="19200">19200</option>
						<option value="38400">38400</option>
						<option value="57600">57600</option>
						<option value="115200">115200</option>
						<option value="128000">128000</option>
						<option value="25600">256000</option>
					</select>
					<button id="start" @click="${this.handleStartStop}">${this.running ? "Stop" : "Start"}</button>
				</div>
				${this.error ? html`<div style="border: 1px solid #300; background: #cc000087; color: #aaa; padding: 1rem;">${this.error}</div>` : nothing}
			</div>
		`;
	}
}

@customElement("serial-plotter")
class SerialPlotter extends LitElement {
	private lineBuffer: string[] = ["Connecting ..."];
	private variableMap: Map<string, number[]> = new Map<string, number[]>();
	private stopped = false;
	private autoScrollEnabled = true;
	@property()
	samplesExceeded = false;

	constructor(readonly port: Port, readonly baudRate: number) {
		super();
	}

	start() {
		const raw = this.querySelector<HTMLElement>("#raw")!;
		const rawParent = raw.parentElement!;
		const variables = this.querySelector<VariablesView>("#variables")!;

		window.addEventListener("message", (ev: { data: ProtocolResponse }) => {
			const message = ev.data;
			if (message.type == "error") {
				// FIXME
			}
			if (message.type == "data") {
				this.processData(message.text, raw, variables);
				if (this.autoScrollEnabled) {
					rawParent.scrollTop = rawParent.scrollHeight;
				}
			}
		});

		const request: StartMonitorPortRequest = {
			type: "start-monitor",
			port: this.port.path,
			baudRate: this.baudRate
		};
		vscode.postMessage(request);
		raw.textContent = this.lineBuffer.join("\n");
	}

	processData(data: string, raw: HTMLElement, variables: VariablesView) {
		if (this.stopped) return;
		const first = this.variableMap.size == 0;
		const lines = data.split("\r\n").filter((line) => line.trim() !== "");
		this.lineBuffer.push(...lines);

		if (this.lineBuffer.length > 1000) {
			this.lineBuffer = this.lineBuffer.slice(-1000);
		}

		lines.forEach((line) => {
			const greaterThanMatches = (line.match(/>/g) || []).length;
			if (line.startsWith(">") && greaterThanMatches === 1) {
				const mentionedVariables = new Set<string>();
				const variables = line.slice(1).split(",");

				const maxLength = Math.max(...Array.from(this.variableMap.values(), (values) => values.length), 0);

				variables.forEach((variable) => {
					const match = variable.match(/(\w+):\s*(-?\d+(\.\d+)?)/);
					if (match) {
						const variableName = match[1];
						const value = parseFloat(match[2]);
						let values = this.variableMap.get(variableName) ?? [];

						if (values.length < maxLength) {
							const padding = Array(maxLength - values.length).fill(null);
							values = [...padding, ...values];
						}

						values.push(value);

						if (values.length > 1000000) {
							values = values.slice(-1000000);
							this.samplesExceeded = true;
						}

						this.variableMap.set(variableName, values);
						mentionedVariables.add(variableName);
					}
				});

				this.variableMap.forEach((values, variableName) => {
					if (!mentionedVariables.has(variableName)) {
						const lastValue = values[values.length - 1];
						values.push(lastValue);
						if (values.length > 1000000) {
							values = values.slice(-1000000);
							this.samplesExceeded = true;
						}

						this.variableMap.set(variableName, values);
					}
				});
			}
		});

		raw.textContent = this.lineBuffer.join("\n");
		variables.requestUpdate();
		this.querySelector("#root")
			?.querySelectorAll<PlotView>("plot-view")
			.forEach((pv) => {
				if (first) {
					for (const name of this.variableMap.keys()) {
						pv.selectedVariables.add(name);
					}
				}
				pv.requestUpdate();
			});
	}

	stop() {
		const request: StopMonitorPortRequest = {
			type: "stop-monitor"
		};
		vscode.postMessage(request);
		this.stopped = true;
	}

	createRenderRoot(): Element | ShadowRoot {
		return this;
	}

	firstUpdated(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		super.firstUpdated(_changedProperties);
		this.start();
	}

	handlePauseAutoScroll() {
		this.autoScrollEnabled = this.querySelector<HTMLInputElement>("#autoscroll")?.checked ?? true;
	}

	handleClearRaw() {
		this.lineBuffer.length = 0;
	}

	handleAddPlot() {
		const plotView = document.createElement("plot-view") as PlotView;
		plotView.data = this.variableMap;
		const buttonElement = this.querySelector("#addplot");
		const rootElement = this.querySelector("#root");
		if (buttonElement && rootElement) {
			rootElement.insertBefore(plotView, buttonElement);
		}
	}

	render() {
		return html`
			<div id="root" style="display: flex; flex-direction: column; gap: 1rem; width: 100%; padding-top: 1rem;">
				${this.samplesExceeded ? html`<div style="border: 1px solid #300; background: #cc000087; color: #aaa; padding: 1rem;"></div>` : nothing}
				<div style="display: flex; flex-direction: column; gap: 1rem; width: 100%; border: 1px solid #aaa; border-radius: 4px; padding: 1rem;">
					<div style="display: flex; gap: 1rem; justify-items: center; align-items: center;">
						<span style="font-size: 1.25rem; font-weight: 600">Raw</span>
						<label><input id="autoscroll" type="checkbox" @change=${this.handlePauseAutoScroll} checked />Auto-scroll</label>
						<button id="clearraw" @click=${this.handleClearRaw}>Clear</button>
					</div>
					<pre style="resize: vertical; overflow: auto; height: 10rem; width: 100%; margin: 0;"><code id="raw"></code></pre>
				</div>
				<variables-view id="variables" .data=${this.variableMap}></variables-view>
				<plot-view .data=${this.variableMap}></plot-view>
				<button id="addplot" @click=${this.handleAddPlot} style="align-self: flex-start">Add plot</button>
			</div>
		`;
	}
}

@customElement("variables-view")
class VariablesView extends LitElement {
	@property()
	data: Map<string, number[]> = new Map<string, number[]>();

	private minMax: Map<string, { min: number; max: number }> = new Map();

	createRenderRoot(): Element | ShadowRoot {
		return this;
	}

	// Calculate min and max for each variable before each update
	willUpdate(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		this.data.forEach((values, key) => {
			if (values.length > 0) {
				const currentMin = Math.min(...values);
				const currentMax = Math.max(...values);
				this.minMax.set(key, {
					min: currentMin,
					max: currentMax
				});
			}
		});
	}

	render() {
		return html`
			<div style="display: flex; flex-direction: column; gap: 1rem; width: 100%; border: 1px solid #aaa; border-radius: 4px; padding: 1rem;">
				<span style="font-size: 1.25rem; font-weight: 600">Variables</span>
				<table style="width: 100%; border-collapse: collapse; table-layout: auto;">
					<thead>
						<tr>
							<th style="border: 1px dashed #aaa; padding: 0.5rem; white-space: nowrap; text-align: center;">Name</th>
							<th style="border: 1px dashed #aaa; padding: 0.5rem; white-space: nowrap; text-align: center;">Min</th>
							<th style="border: 1px dashed #aaa; padding: 0.5rem; white-space: nowrap; text-align: center;">Max</th>
							<th style="border: 1px dashed #aaa; padding: 0.5rem; white-space: nowrap; text-align: center;">Current</th>
						</tr>
					</thead>
					<tbody>
						${Array.from(this.data.entries()).map(([key, values]) => {
							const current = values[values.length - 1];
							const minMax = this.minMax.get(key) || { min: 0, max: 0 };

							return html`
								<tr>
									<td style="border: 1px dashed #aaa; padding: 0.5rem; white-space: nowrap; text-align: center;">${key}</td>
									<td style="border: 1px dashed #aaa; padding: 0.5rem; white-space: nowrap; text-align: center;">${minMax.min}</td>
									<td style="border: 1px dashed #aaa; padding: 0.5rem; white-space: nowrap; text-align: center;">${minMax.max}</td>
									<td style="border: 1px dashed #aaa; padding: 0.5rem; white-space: nowrap; text-align: center;">${current}</td>
								</tr>
							`;
						})}
					</tbody>
				</table>
			</div>
		`;
	}
}

@customElement("plot-view")
class PlotView extends LitElement {
	@property()
	data: Map<string, number[]> = new Map<string, number[]>();
	dataColors: Map<string, string> = new Map<string, string>();
	canvas!: HTMLCanvasElement;
	ctx!: CanvasRenderingContext2D;
	@property()
	padding = 10;
	@property()
	lineWidth = 2;
	@property({ type: Number })
	visibleSamples = 100;
	@property()
	scrollOffset = (this.visibleSamples - 1) / 2;
	autoScroll = true;
	maxSamples = 1000000;
	selectedVariables: Set<string> = new Set();
	isDragging = false;
	startDragX = 0;
	startScrollOffset = 0;

	createRenderRoot(): Element | ShadowRoot {
		return this;
	}

	handleClose() {
		this.remove();
	}

	firstUpdated(_changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void {
		super.firstUpdated(_changedProperties);
		this.canvas = this.querySelector<HTMLCanvasElement>("canvas")!;
		this.ctx = this.canvas.getContext("2d")!;
		this.canvas.addEventListener("mousedown", this.handleMouseDown.bind(this));
		this.canvas.addEventListener("mousemove", this.handleMouseMove.bind(this));
		this.canvas.addEventListener("mouseup", this.handleMouseUp.bind(this));
		this.canvas.addEventListener("mouseleave", this.handleMouseUp.bind(this));
		if (this.selectedVariables.size === 0) {
			for (const name of this.data.keys()) {
				this.selectedVariables.add(name);
			}
		}
		this.renderData();
	}

	getDataColor(name: string): string {
		if (this.dataColors.has(name)) return this.dataColors.get(name)!;

		const palette = [
			"#FF5733",
			"#33FF57",
			"#3357FF",
			"#F39C12",
			"#9B59B6",
			"#1ABC9C",
			"#E74C3C",
			"#3498DB",
			"#2ECC71",
			"#E67E22",
			"#8E44AD",
			"#16A085",
			"#C0392B",
			"#2980B9",
			"#27AE60",
			"#D35400"
		];

		const index = Array.from(this.data.keys()).indexOf(name) % palette.length;
		const color = palette[index];

		this.dataColors.set(name, color);
		return color;
	}

	toggleVariableSelection(event: Event) {
		const checkbox = event.target as HTMLInputElement;
		const variable = checkbox.value;

		if (checkbox.checked) {
			this.selectedVariables.add(variable);
		} else {
			this.selectedVariables.delete(variable);
		}
	}

	handleMouseDown(event: MouseEvent) {
		if (!this.autoScroll) {
			this.isDragging = true;
			this.startDragX = event.clientX;
			this.startScrollOffset = this.scrollOffset;
		}
	}

	handleMouseMove(event: MouseEvent) {
		if (this.isDragging && !this.autoScroll) {
			const deltaX = event.clientX - this.startDragX;
			const pixelsPerSample = this.canvas.clientWidth / (this.visibleSamples - 1);
			this.scrollOffset = this.startScrollOffset - deltaX / pixelsPerSample;
		}
	}

	handleMouseUp() {
		this.isDragging = false;
	}

	handleVisibleSamplesChange(e: Event) {
		const target = e.target as HTMLInputElement;
		this.visibleSamples = parseInt(target.value, 10);
	}

	handleAutoScrollChange(e: Event) {
		const checkbox = e.target as HTMLInputElement;
		this.autoScroll = checkbox.checked;
		const maxSamples = Math.max(...Array.from(this.data.values()).map((line) => line.length));
		this.scrollOffset = maxSamples - this.visibleSamples / 2;
	}

	renderData() {
		if (!this.isConnected) {
			return;
		}

		requestAnimationFrame(() => this.renderData());

		const canvas = this.canvas;
		const ctx = this.ctx;
		const dpr = window.devicePixelRatio;
		const w = canvas.clientWidth * dpr;
		const h = canvas.clientHeight * dpr;

		if (canvas.width != w || canvas.height != h) {
			canvas.width = canvas.clientWidth * dpr;
			canvas.height = canvas.clientHeight * dpr;
		}

		ctx.clearRect(0, 0, w, h);

		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;

		// Determine which samples are within the viewport
		const maxSamples = Math.max(...Array.from(this.data.values()).map((line) => line.length));
		const startSample = Math.max(0, Math.floor(this.scrollOffset - this.visibleSamples / 2));
		const endSample = Math.min(Math.ceil(this.scrollOffset + this.visibleSamples / 2), maxSamples - 1);

		// Find global min/max values to normalize data
		for (const [name, line] of this.data.entries()) {
			if (!this.selectedVariables.has(name) || line.length < 2) continue;
			for (let i = startSample; i <= endSample; i++) {
				const value = line[i];
				min = Math.min(min, value);
				max = Math.max(max, value);
			}
		}

		const height = max - min;
		const padding = this.padding;
		const lineWidth = this.lineWidth;
		const baseFontSize = 12;
		const scaledFontSize = baseFontSize * dpr;
		const labelPadding = scaledFontSize;
		const scaleY = height !== 0 ? (h - padding * 2 - labelPadding * 2) / height : 1;

		// Calculate pixels per sample
		const pixelsPerSample = (w - padding * 2) / (this.visibleSamples - 1);

		// If auto-scroll is enabled, update scrollOffset to smoothly interpolate towards the latest sample
		if (this.autoScroll && maxSamples > this.visibleSamples) {
			const targetScrollOffset = maxSamples - this.visibleSamples / 2;
			this.scrollOffset = this.scrollOffset * 0.4 + targetScrollOffset * 0.6;
		}
		// Draw Y-axis labels
		ctx.save();
		const labelHeight = 50;
		const numYLabels = Math.floor(h / labelHeight);
		ctx.fillStyle = "#aaa";
		ctx.font = `${scaledFontSize}px Arial`;
		ctx.textAlign = "left";

		ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
		ctx.lineWidth = 1 * dpr;
		for (let i = 0; i <= numYLabels; i++) {
			const yValue = min + (i / numYLabels) * height;
			const y = h - labelPadding - padding - (yValue - min) * scaleY;
			ctx.beginPath();
			ctx.moveTo(padding, y);
			ctx.lineTo(w - padding, y);
			ctx.stroke();
			ctx.fillText(yValue.toFixed(2), 5 * dpr, y + scaledFontSize / 2);
		}
		ctx.restore();

		// Draw X-axis labels
		ctx.save();
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		ctx.fillStyle = "#aaa";
		ctx.font = `${scaledFontSize}px Arial`;

		const labelWidthPx = 96 * dpr;
		const numXLabels = Math.floor(w / labelWidthPx);
		const step = Math.ceil(this.visibleSamples / numXLabels);

		for (let i = startSample; i <= endSample; i++) {
			const x = padding + (i - this.scrollOffset + this.visibleSamples / 2) * pixelsPerSample;

			if (x >= padding && x <= w - padding && i % step === 0) {
				ctx.fillText(i.toString(), x, h - labelPadding);
			}
		}
		ctx.restore();

		// Plot data for visible samples
		for (const [name, line] of this.data.entries()) {
			if (!this.selectedVariables.has(name) || line.length < 2) continue;

			ctx.strokeStyle = this.getDataColor(name);
			ctx.lineWidth = lineWidth;
			ctx.save();
			ctx.beginPath();
			let hasStarted = false;

			for (let i = startSample; i <= endSample && i < line.length; i++) {
				const value = line[i];
				if (value != null) {
					const x = padding + (i - this.scrollOffset + this.visibleSamples / 2) * pixelsPerSample;
					const y = h - labelPadding - padding - (value - min) * scaleY;

					if (!hasStarted) {
						ctx.moveTo(x, y);
						hasStarted = true;
					} else {
						ctx.lineTo(x, y);
					}
				}
			}

			ctx.stroke();
			ctx.restore();
		}
	}

	render() {
		return html`
			<div style="display: flex; flex-direction: column; gap: 1rem; width: 100%; border: 1px solid #aaa; border-radius: 4px; padding: 1rem;">
				<div style="display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;">
					<div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
						${Array.from(this.data.keys()).map(
							(variable) => html`
								<label style="color: ${this.getDataColor(variable)};">
									<input type="checkbox" value="${variable}" .checked="${this.selectedVariables.has(variable)}" @change=${this.toggleVariableSelection} />
									${variable}
								</label>
							`
						)}
					</div>
					<button style="align-self: flex-start;" @click=${this.handleClose}>Close</button>
				</div>

				<div style="display: flex; align-items: center; gap: 0.5rem;">
					<label>Auto-scroll</label>
					<input type="checkbox" .checked="${this.autoScroll}" @change=${this.handleAutoScrollChange} />
					<label>Zoom</label>
					<input
						type="range"
						min="10"
						max="1000"
						value="${this.visibleSamples}"
						@input=${this.handleVisibleSamplesChange}
						style="flex-grow: 1; max-width: 350px; outline: none;"
					/>
				</div>

				<div style="resize: vertical; overflow: auto; width: 100%; height: 400px;">
					<canvas style="display: block; width: 100%; height: 100%;"></canvas>
				</div>
			</div>
		`;
	}
}

document.body.append(new PortSelector());

