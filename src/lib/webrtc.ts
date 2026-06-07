// WebRTC call manager. Framework-agnostic: it manages the peer connection and
// media streams, and emits state changes via callbacks. Signaling messages are
// sent/received through a transport (Supabase Realtime broadcast) supplied by
// the caller.

export type CallStatus =
  | "idle"
  | "calling"
  | "incoming"
  | "connected"
  | "ended";

export type CallSignal =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit; video: boolean }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit }
  | { kind: "end" };

export interface CallCallbacks {
  send: (signal: CallSignal) => void;
  onStatus: (status: CallStatus) => void;
  onLocalStream: (stream: MediaStream | null) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  onVideoChange: (video: boolean) => void;
}

function iceServers(): RTCIceServer[] {
  // STUN handles direct connections; the Metered TURN relays handle calls when
  // both peers are behind strict NATs / on mobile data (different networks).
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "bc9ef72cee7cb027811ed14f",
      credential: "01nBGeJv/AwzzLxP",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "bc9ef72cee7cb027811ed14f",
      credential: "01nBGeJv/AwzzLxP",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "bc9ef72cee7cb027811ed14f",
      credential: "01nBGeJv/AwzzLxP",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "bc9ef72cee7cb027811ed14f",
      credential: "01nBGeJv/AwzzLxP",
    },
  ];
  const extra = process.env.NEXT_PUBLIC_TURN_SERVERS;
  if (extra) {
    try {
      const parsed = JSON.parse(extra) as RTCIceServer[];
      if (Array.isArray(parsed)) servers.push(...parsed);
    } catch {
      // Ignore malformed TURN config.
    }
  }
  return servers;
}

export class CallManager {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private pendingOffer: { sdp: RTCSessionDescriptionInit; video: boolean } | null =
    null;
  // ICE candidates that arrive before the remote description is set are
  // queued here, then applied once it is — otherwise calls fail to connect.
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private cb: CallCallbacks;

  constructor(cb: CallCallbacks) {
    this.cb = cb;
  }

  private createPeer() {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });

    pc.onicecandidate = (e) => {
      if (e.candidate) this.cb.send({ kind: "ice", candidate: e.candidate.toJSON() });
    };

    pc.ontrack = (e) => {
      this.cb.onRemoteStream(e.streams[0] ?? null);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.cb.onStatus("connected");
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected" ||
        pc.connectionState === "closed"
      ) {
        this.cleanup();
        this.cb.onStatus("ended");
      }
    };

    this.pc = pc;
    return pc;
  }

  private async getMedia(video: boolean) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video,
    });
    this.localStream = stream;
    this.cb.onLocalStream(stream);
    return stream;
  }

  // Place an outgoing call.
  async start(video: boolean) {
    this.cb.onVideoChange(video);
    this.cb.onStatus("calling");
    const pc = this.createPeer();
    const stream = await this.getMedia(video);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.cb.send({ kind: "offer", sdp: offer, video });
  }

  // Accept an incoming call (after the user taps "Answer").
  async accept() {
    if (!this.pendingOffer) return;
    const { sdp, video } = this.pendingOffer;
    this.cb.onVideoChange(video);
    const pc = this.createPeer();
    const stream = await this.getMedia(video);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    await this.flushCandidates();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.cb.send({ kind: "answer", sdp: answer });
    this.pendingOffer = null;
  }

  private async flushCandidates() {
    if (!this.pc) return;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of queued) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        // ignore bad candidate
      }
    }
  }

  // Handle a signaling message received from the partner.
  async handleSignal(signal: CallSignal) {
    switch (signal.kind) {
      case "offer":
        this.pendingOffer = { sdp: signal.sdp, video: signal.video };
        this.cb.onVideoChange(signal.video);
        this.cb.onStatus("incoming");
        break;
      case "answer":
        if (this.pc) {
          await this.pc.setRemoteDescription(
            new RTCSessionDescription(signal.sdp)
          );
          await this.flushCandidates();
        }
        break;
      case "ice":
        // Apply immediately if the connection is ready, otherwise queue it.
        if (this.pc && this.pc.remoteDescription) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch {
            // ignore bad candidate
          }
        } else {
          this.pendingCandidates.push(signal.candidate);
        }
        break;
      case "end":
        this.cleanup();
        this.cb.onStatus("ended");
        break;
    }
  }

  toggleMute(): boolean {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return !track.enabled; // returns true when muted
  }

  toggleCamera(): boolean {
    const track = this.localStream?.getVideoTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return !track.enabled; // returns true when camera off
  }

  // End the call locally and tell the partner.
  hangup() {
    this.cb.send({ kind: "end" });
    this.cleanup();
    this.cb.onStatus("ended");
  }

  private cleanup() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.pendingOffer = null;
    this.pendingCandidates = [];
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    this.cb.onLocalStream(null);
    this.cb.onRemoteStream(null);
  }
}
