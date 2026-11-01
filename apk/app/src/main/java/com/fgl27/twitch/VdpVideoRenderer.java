package com.fgl27.twitch;

import android.annotation.SuppressLint;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.media3.exoplayer.ExoPlaybackException;
import androidx.media3.exoplayer.Renderer;
import androidx.media3.exoplayer.mediacodec.MediaCodecAdapter;
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo;
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer;

//MTK TV OMX decoders: the MTK codec plugin gives each decoder a video path when the decoder is created, the first free one
//(log "MtkACodecPlugin: add usage GRALLOC_USAGE_PATH_VDP0/1"). The hardware composer draws VDP0 on the main plane and VDP1
//on the sub plane, always on top, whatever the layer z-order. A decoder keeps its path when it moves to another surface, so
//after a PiP swap the small window was hidden behind the big one. This renderer tracks the path of its decoder and lets
//PlayerActivity re-create the decoders in position order (big window first) by holding the codec init
@SuppressLint("UnsafeOptInUsageError")
final class VdpVideoRenderer extends MediaCodecVideoRenderer {

    interface Callback {
        //Both called on the playback thread
        void onVdpCodecInitialized(VdpVideoRenderer renderer);

        void onVdpCodecReleased(VdpVideoRenderer renderer);
    }

    static final int MSG_RELEASE_AND_HOLD = Renderer.MSG_CUSTOM_BASE;
    static final int MSG_RESUME = Renderer.MSG_CUSTOM_BASE + 1;

    private static final String VDP_DECODER = "OMX.MTK.VIDEO.DECODER";
    private static final VdpVideoRenderer[] VdpOwner = new VdpVideoRenderer[2];

    private final Callback callback;
    private volatile boolean holdInit;
    volatile int vdpPath = -1;

    VdpVideoRenderer(MediaCodecVideoRenderer.Builder builder, Callback callback) {
        super(builder);
        this.callback = callback;
    }

    @Override
    protected boolean shouldInitCodec(MediaCodecInfo codecInfo) {
        return !holdInit && super.shouldInitCodec(codecInfo);
    }

    @Override
    protected void onCodecInitialized(
        String name,
        MediaCodecAdapter.Configuration configuration,
        long initializedTimestampMs,
        long initializationDurationMs
    ) {
        super.onCodecInitialized(name, configuration, initializedTimestampMs, initializationDurationMs);
        if (!name.startsWith(VDP_DECODER)) return;

        synchronized (VdpOwner) {
            for (int i = 0; i < VdpOwner.length; i++) {
                if (VdpOwner[i] == null) {
                    VdpOwner[i] = this;
                    vdpPath = i;
                    break;
                }
            }
        }

        if (BuildConfig.DEBUG) Log.i("STTV_Vdp", "path " + vdpPath + " " + this);
        callback.onVdpCodecInitialized(this);
    }

    @Override
    protected void onCodecReleased(String name) {
        super.onCodecReleased(name);
        if (vdpPath < 0) return;
        if (BuildConfig.DEBUG) Log.i("STTV_Vdp", "release path " + vdpPath + " " + this);

        synchronized (VdpOwner) {
            if (VdpOwner[vdpPath] == this) VdpOwner[vdpPath] = null;
            vdpPath = -1;
        }

        callback.onVdpCodecReleased(this);
    }

    @Override
    public void handleMessage(@MessageType int messageType, @Nullable Object message) throws ExoPlaybackException {
        if (messageType == MSG_RELEASE_AND_HOLD) {
            holdInit = true;
            //The new decoder skips samples up to the next key frame, so the window shows no video until then
            releaseCodec();
        } else if (messageType == MSG_RESUME) {
            holdInit = false;
        } else {
            super.handleMessage(messageType, message);
        }
    }
}
