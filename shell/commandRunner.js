import Gio from 'gi://Gio';

export class CommandRunner {
    constructor() {
        this.cancellable = new Gio.Cancellable();
        this._processes = new Set();
    }

    run(argv, stdin = null) {
        return new Promise((resolve, reject) => {
            const stdinFlag = stdin === null
                ? Gio.SubprocessFlags.NONE
                : Gio.SubprocessFlags.STDIN_PIPE;
            const process = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | stdinFlag);
            this._processes.add(process);

            process.communicate_utf8_async(stdin, this.cancellable, (source, result) => {
                this._processes.delete(source);
                try {
                    const [, stdout] = source.communicate_utf8_finish(result);
                    resolve({ok: source.get_successful(), stdout});
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    destroy() {
        this.cancellable.cancel();
        for (const process of this._processes)
            process.force_exit();
        this._processes.clear();
    }
}
