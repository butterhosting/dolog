import { execFile } from "node:child_process";
import { promisify } from "node:util";

export namespace DockerBoundary {
  const exec = promisify(execFile);

  type RunToCompletion = {
    name: string;
    line: string;
  };

  export async function runToCompletion({ name, line }: RunToCompletion): Promise<void> {
    await exec("docker", ["run", "--name", name, "alpine", "sh", "-c", `echo "${line}"; sleep 2`]);
  }

  type RunQuietly = {
    name: string;
    lines: number;
  };
  export async function runQuietly({ name, lines }: RunQuietly): Promise<void> {
    const script = `sleep 2; i=0; while [ $i -lt ${lines} ]; do i=$((i + 1)); echo $i; [ $((i % 90)) -eq 0 ] && sleep 1.1; done; sleep 300`;
    await exec("docker", ["run", "--detach", "--name", name, "alpine", "sh", "-c", script]);
  }

  export async function remove(name: string): Promise<void> {
    await exec("docker", ["rm", "--force", name]);
  }
}
