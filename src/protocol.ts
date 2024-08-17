interface Port {
	path: string;
	manufacturer?: string;
}

interface PortsRequest {
	type: "ports";
}

interface PortsResponse {
	type: "ports-response";
	ports: Port[];
}

interface StartMonitorPortRequest {
	type: "start-monitor";
	port: string;
	baudRate: number;
}

interface StopMonitorPortRequest {
	type: "stop-monitor";
}

interface ErrorResponse {
	type: "error";
	text: string;
}

interface DataResponse {
	type: "data",
	text: string;
}

type ProtocolRequests = PortsRequest | StartMonitorPortRequest | StopMonitorPortRequest;
type ProtocolResponse = PortsResponse | DataResponse | ErrorResponse;