import {spawn, ChildProcess} from 'child_process';

export class ProcessManager {
  private processes: Map<string, ChildProcess> = new Map();

  startProcess(id: string, command: string, args: string[]): ChildProcess {
    if (this.processes.has(id)) {
      console.warn(`Process with id ${id} is already running.`);
      return this.processes.get(id)!;
    }

    const process = spawn(command, args);
    this.processes.set(id, process);

    process.on('error', (err) => {
      console.error(err);
    });

    process.on('close', (code) => {
      console.log(`[${id}] child process exited with code ${code}`);
      this.processes.delete(id);
    });

    console.log(`Started process ${id}`);
    return process;
  }

  stopProcess(id: string): void {
    const process = this.processes.get(id);
    if (process) {
      process.kill();
      this.processes.delete(id);
      console.log(`Stopped process ${id}`);
    } else {
      console.warn(`No process found with id ${id}`);
    }
  }

  listProcesses(): string[] {
    return Array.from(this.processes.keys());
  }
}
