export interface MainToWorkerMessageInit {
    type: 'INIT';
    buffer: SharedArrayBuffer;
}

export interface MainToWorkerMessageSetTickRate {
    type: 'SET_TICK_RATE';
    rate: number;
}

export type MainToWorkerMessage = MainToWorkerMessageInit | MainToWorkerMessageSetTickRate;

export interface WorkerToMainMessageReady {
    type: 'READY';
}

export type WorkerToMainMessage = WorkerToMainMessageReady;
