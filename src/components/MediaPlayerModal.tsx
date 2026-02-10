import React, { useState, useEffect, useCallback } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    CircularProgress,
    LinearProgress,
    Chip,
    Alert,
    IconButton,
    Divider,
    GridLegacy as Grid,
} from '@mui/material';
import {
    Close as CloseIcon,
    PlayArrow as PlayIcon,
    Pause as PauseIcon,
    Stop as StopIcon,
    LiveTv as LiveIcon,
    Error as ErrorIcon,
} from '@mui/icons-material';
import { RokuDevice } from '../store';
import { getMediaPlayer, type MediaPlayerInfo } from '../services/rokuClient';

interface MediaPlayerModalProps {
    open: boolean;
    onClose: () => void;
    device: RokuDevice;
}

const MediaPlayerModal: React.FC<MediaPlayerModalProps> = ({ open, onClose, device }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [mediaInfo, setMediaInfo] = useState<MediaPlayerInfo | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const fetchMediaPlayerInfo = useCallback(async () => {
        try {
            setRefreshing(true);
            const info = await getMediaPlayer(device.ip, device.port);
            setMediaInfo(info);
            setError(null);
        } catch (err) {
            console.error('Error fetching media player info:', err);
            let errorMessage = String(err);
            
            if (errorMessage.includes('parse') || errorMessage.includes('XML')) {
                errorMessage = `XML parsing error. The Roku device may not be playing content or doesn't support media-player queries. Original error: ${errorMessage}`;
            }
            
            setError(errorMessage);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [device.ip, device.port]);

    useEffect(() => {
        if (open) {
            setLoading(true);
            setError(null);
            void fetchMediaPlayerInfo();

            const interval = setInterval(() => {
                void fetchMediaPlayerInfo();
            }, 2000);
            return () => clearInterval(interval);
        }
    }, [open, fetchMediaPlayerInfo]);

    const parseTime = (timeStr?: string): number => {
        if (!timeStr) return 0;
        const match = timeStr.match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    };

    const formatTime = (ms: number): string => {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const getStateIcon = (state: string): React.ReactElement | undefined => {
        switch (state) {
            case 'play':
                return <PlayIcon />;
            case 'pause':
                return <PauseIcon />;
            case 'stop':
                return <StopIcon />;
            default:
                return undefined;
        }
    };

    const getStateColor = (state: string): "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning" => {
        switch (state) {
            case 'play':
                return 'success';
            case 'pause':
                return 'warning';
            case 'stop':
                return 'default';
            case 'error':
                return 'error';
            default:
                return 'default';
        }
    };

    const renderContent = () => {
        if (loading && !mediaInfo) {
            return (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                    <CircularProgress />
                </Box>
            );
        }

        if (error) {
            return (
                <Alert severity="error" sx={{ m: 2 }}>
                    {error}
                </Alert>
            );
        }

        if (!mediaInfo) {
            return (
                <Typography color="text.secondary" sx={{ p: 2 }}>
                    No media player information available
                </Typography>
            );
        }

        const position = parseTime(mediaInfo.position);
        const duration = parseTime(mediaInfo.duration);
        const progress = duration > 0 ? (position / duration) * 100 : 0;

        return (
            <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                    <Chip
                        icon={mediaInfo.error ? <ErrorIcon /> : getStateIcon(mediaInfo.state)}
                        label={mediaInfo.state.toUpperCase()}
                        color={getStateColor(mediaInfo.error ? 'error' : mediaInfo.state)}
                        variant="filled"
                    />
                    {mediaInfo.is_live && (
                        <Chip
                            icon={<LiveIcon />}
                            label="LIVE"
                            color="error"
                            variant="outlined"
                        />
                    )}
                    {mediaInfo.plugin && (
                        <Typography variant="body2" color="text.secondary">
                            {mediaInfo.plugin.name}
                        </Typography>
                    )}
                </Box>

                {!mediaInfo.is_live && duration > 0 && (
                    <Box sx={{ mb: 3 }}>
                        <LinearProgress
                            variant="determinate"
                            value={progress}
                            sx={{ height: 8, borderRadius: 1 }}
                        />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                            <Typography variant="caption">
                                {formatTime(position)}
                            </Typography>
                            <Typography variant="caption">
                                {formatTime(duration)}
                            </Typography>
                        </Box>
                    </Box>
                )}

                <Divider sx={{ my: 2 }} />

                {mediaInfo.format && (
                    <Box sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Media Format
                        </Typography>
                        <Grid container spacing={1}>
                            <Grid item xs={6}>
                                <Typography variant="caption" color="text.secondary">
                                    Video:
                                </Typography>
                                <Typography variant="body2">
                                    {mediaInfo.format.video} ({mediaInfo.format.video_res})
                                </Typography>
                            </Grid>
                            <Grid item xs={6}>
                                <Typography variant="caption" color="text.secondary">
                                    Audio:
                                </Typography>
                                <Typography variant="body2">
                                    {mediaInfo.format.audio}
                                </Typography>
                            </Grid>
                            <Grid item xs={6}>
                                <Typography variant="caption" color="text.secondary">
                                    Container:
                                </Typography>
                                <Typography variant="body2">
                                    {mediaInfo.format.container}
                                </Typography>
                            </Grid>
                            <Grid item xs={6}>
                                <Typography variant="caption" color="text.secondary">
                                    Captions:
                                </Typography>
                                <Typography variant="body2">
                                    {mediaInfo.format.captions}
                                </Typography>
                            </Grid>
                            {mediaInfo.format.drm !== 'none' && (
                                <Grid item xs={12}>
                                    <Typography variant="caption" color="text.secondary">
                                        DRM:
                                    </Typography>
                                    <Typography variant="body2">
                                        {mediaInfo.format.drm}
                                    </Typography>
                                </Grid>
                            )}
                        </Grid>
                    </Box>
                )}

                {mediaInfo.plugin && (
                    <Box>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Plugin Details
                        </Typography>
                        <Grid container spacing={1}>
                            <Grid item xs={6}>
                                <Typography variant="caption" color="text.secondary">
                                    ID:
                                </Typography>
                                <Typography variant="body2">
                                    {mediaInfo.plugin.id}
                                </Typography>
                            </Grid>
                            <Grid item xs={6}>
                                <Typography variant="caption" color="text.secondary">
                                    Bandwidth:
                                </Typography>
                                <Typography variant="body2">
                                    {mediaInfo.plugin.bandwidth}
                                </Typography>
                            </Grid>
                        </Grid>
                    </Box>
                )}
            </Box>
        );
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    borderRadius: 2,
                }
            }}
        >
            <DialogTitle sx={{ m: 0, p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="h6">Media Player Status</Typography>
                    <IconButton
                        aria-label="close"
                        onClick={onClose}
                        sx={{ color: 'text.secondary' }}
                    >
                        <CloseIcon />
                    </IconButton>
                </Box>
                <Typography variant="caption" color="text.secondary">
                    {device.name} ({device.ip})
                </Typography>
            </DialogTitle>
            <DialogContent dividers>
                {refreshing && mediaInfo && (
                    <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />
                )}
                {renderContent()}
            </DialogContent>
            <DialogActions>
                <Button onClick={fetchMediaPlayerInfo} disabled={refreshing}>
                    Refresh
                </Button>
                <Button onClick={onClose} variant="contained">
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default MediaPlayerModal;
