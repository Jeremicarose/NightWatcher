import Docker from 'dockerode';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Docker');

// Docker client singleton
let docker: Docker | null = null;

/**
 * Get or create Docker client instance.
 */
export function getDocker(): Docker {
  if (!docker) {
    docker = new Docker();
    logger.info('Docker client initialized');
  }
  return docker;
}

/**
 * Check if Docker is available and running.
 */
export async function checkDockerAvailable(): Promise<boolean> {
  try {
    const client = getDocker();
    await client.ping();
    logger.debug('Docker is available');
    return true;
  } catch (error) {
    logger.error('Docker is not available', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return false;
  }
}

/**
 * Pull a Docker image if not already present.
 */
export async function ensureImage(imageName: string): Promise<void> {
  const client = getDocker();

  try {
    // Check if image exists locally
    const images = await client.listImages({
      filters: { reference: [imageName] }
    });

    if (images.length > 0) {
      logger.debug('Image already exists', { imageName });
      return;
    }

    // Pull the image
    logger.info('Pulling Docker image', { imageName });

    await new Promise<void>((resolve, reject) => {
      client.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }

        client.modem.followProgress(stream, (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });

    logger.info('Image pulled successfully', { imageName });
  } catch (error) {
    logger.error('Failed to ensure image', {
      imageName,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

export interface ContainerConfig {
  image: string;
  workDir: string;
  hostDir: string;
  env?: Record<string, string>;
  timeout?: number; // in milliseconds
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Create and start a container for running tests.
 */
export async function createContainer(config: ContainerConfig): Promise<Docker.Container> {
  const client = getDocker();

  logger.info('Creating container', { image: config.image, workDir: config.workDir });

  // Convert env object to array format
  const envArray = config.env
    ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`)
    : [];

  const container = await client.createContainer({
    Image: config.image,
    WorkingDir: config.workDir,
    Env: envArray,
    Tty: false,
    HostConfig: {
      Binds: [`${config.hostDir}:${config.workDir}`],
      AutoRemove: false, // We'll remove manually after getting logs
      Memory: 512 * 1024 * 1024, // 512MB memory limit
      MemorySwap: 512 * 1024 * 1024, // No swap
      CpuPeriod: 100000,
      CpuQuota: 50000, // 50% CPU limit
      NetworkMode: 'bridge', // Allow network for pip install
    },
    Cmd: ['sleep', 'infinity'], // Keep container running
  });

  await container.start();
  logger.debug('Container started', { id: container.id.substring(0, 12) });

  return container;
}

/**
 * Execute a command inside a container.
 */
export async function execInContainer(
  container: Docker.Container,
  cmd: string[],
  timeout: number = 120000 // 2 minutes default
): Promise<ExecResult> {
  logger.debug('Executing command', { cmd: cmd.join(' ').substring(0, 100) });

  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });

  return new Promise<ExecResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeoutId = setTimeout(async () => {
      timedOut = true;
      logger.warn('Command timed out', { timeout });
      // Kill the exec process
      try {
        await container.kill({ signal: 'SIGKILL' });
      } catch {
        // Container might already be stopped
      }
    }, timeout);

    exec.start({ hijack: true, stdin: false }, (err: Error | null, stream: NodeJS.ReadableStream | undefined) => {
      if (err || !stream) {
        clearTimeout(timeoutId);
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: err?.message || 'Failed to start exec',
          timedOut: false,
        });
        return;
      }

      // Demux stdout and stderr
      const dockerStream = stream as any;

      dockerStream.on('data', (chunk: Buffer) => {
        // Docker multiplexes stdout/stderr with an 8-byte header
        // Header: [STREAM_TYPE, 0, 0, 0, SIZE1, SIZE2, SIZE3, SIZE4]
        let offset = 0;
        while (offset < chunk.length) {
          if (offset + 8 > chunk.length) break;

          const streamType = chunk[offset];
          const size = chunk.readUInt32BE(offset + 4);
          offset += 8;

          if (offset + size > chunk.length) break;

          const data = chunk.slice(offset, offset + size).toString('utf8');
          offset += size;

          if (streamType === 1) {
            stdout += data;
          } else {
            stderr += data;
          }
        }
      });

      dockerStream.on('end', async () => {
        clearTimeout(timeoutId);

        if (timedOut) {
          resolve({
            exitCode: 124, // Standard timeout exit code
            stdout,
            stderr: stderr + '\n[TIMEOUT]',
            timedOut: true,
          });
          return;
        }

        // Get exit code
        try {
          const inspectData = await exec.inspect();
          resolve({
            exitCode: inspectData.ExitCode ?? 1,
            stdout,
            stderr,
            timedOut: false,
          });
        } catch {
          resolve({
            exitCode: 1,
            stdout,
            stderr,
            timedOut: false,
          });
        }
      });

      dockerStream.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr + '\n' + err.message,
          timedOut: false,
        });
      });
    });
  });
}

/**
 * Stop and remove a container.
 */
export async function removeContainer(container: Docker.Container): Promise<void> {
  const id = container.id.substring(0, 12);

  try {
    logger.debug('Stopping container', { id });
    await container.stop({ t: 5 }).catch(() => {}); // Ignore if already stopped

    logger.debug('Removing container', { id });
    await container.remove({ force: true });

    logger.debug('Container removed', { id });
  } catch (error) {
    logger.warn('Failed to remove container', {
      id,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Get container logs.
 */
export async function getContainerLogs(container: Docker.Container): Promise<string> {
  const logs = await container.logs({
    stdout: true,
    stderr: true,
    follow: false,
  });

  return logs.toString('utf8');
}
