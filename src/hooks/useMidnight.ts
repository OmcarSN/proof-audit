import { useCallback, useEffect, useState } from 'react';
import {
  connectLace,
  clearConnection,
  isAlreadyConnected,
  waitForConnector,
  inspectInjection,
  DISCONNECT_HINT,
  type ConnectionInfo,
  type InjectionDebug,
} from '../midnight/connector';

export type WalletStatus =
  | 'detecting'
  | 'unavailable'
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error';

export interface UseMidnight {
  status: WalletStatus;
  connection: ConnectionInfo | null;
  error: string | null;
  hint: string | null;
  injection: InjectionDebug;
  connect: () => Promise<void>;
  disconnect: () => void;
  redetect: () => Promise<void>;
}

export function useMidnight(): UseMidnight {
  const [status, setStatus] = useState<WalletStatus>('detecting');
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [injection, setInjection] = useState<InjectionDebug>(() => inspectInjection());

  const detect = useCallback(async () => {
    setStatus('detecting');
    const connector = await waitForConnector(4000);
    setInjection(inspectInjection());
    if (!connector) {
      setStatus('unavailable');
      return;
    }
    // Try restoring existing session
    if (await isAlreadyConnected()) {
      try {
        const info = await connectLace();
        setConnection(info);
        setStatus('connected');
        return;
      } catch {
        /* fall through to idle */
      }
    }
    setStatus('idle');
  }, []);

  useEffect(() => {
    void detect();
    const onFocus = () => setInjection(inspectInjection());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [detect]);

  const connect = useCallback(async () => {
    setError(null);
    setHint(null);
    setStatus('connecting');
    try {
      const info = await connectLace();
      setConnection(info);
      setInjection(inspectInjection());
      setStatus('connected');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      const inj = inspectInjection();
      setInjection(inj);
      setStatus('error');
    }
  }, []);

  const disconnect = useCallback(() => {
    clearConnection();
    setConnection(null);
    setError(null);
    setHint(DISCONNECT_HINT);
    setStatus('idle');
  }, []);

  return { status, connection, error, hint, injection, connect, disconnect, redetect: detect };
}
