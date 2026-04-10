"""
Video analysis pipeline:
1. Download video from Google Drive
2. Extract audio with ffmpeg
3. Transcribe with word-level timestamps + diarization
4. Analyze transcript with LLM to produce structured segments
"""

import sys
import os
import json
import subprocess
import tempfile
import re
import base64

# ── Step 0: Parse args ──────────────────────────────────────────────────
drive_url = sys.argv[1]
output_path = sys.argv[2]
status_path = sys.argv[3]  # file to write status updates


def update_status(status: str, message: str = ""):
    with open(status_path, "w") as f:
        json.dump({"status": status, "message": message}, f)


def extract_file_id(url: str) -> str:
    """Extract Google Drive file ID from various URL formats."""
    patterns = [
        r"/file/d/([a-zA-Z0-9_-]+)",
        r"id=([a-zA-Z0-9_-]+)",
        r"^([a-zA-Z0-9_-]{20,})$",
    ]
    for p in patterns:
        m = re.search(p, url)
        if m:
            return m.group(1)
    raise ValueError(f"Could not extract file ID from: {url}")


try:
    file_id = extract_file_id(drive_url)
except ValueError as e:
    update_status("error", str(e))
    sys.exit(1)

# Use workspace for temp files — /tmp is a 4GB tmpfs that can't hold large videos
tmpdir = tempfile.mkdtemp(dir=os.path.expanduser("~"))
video_path = os.path.join(tmpdir, "video.mp4")
audio_path = os.path.join(tmpdir, "audio.mp3")

# ── Step 1: Download from Google Drive ───────────────────────────────────
update_status("downloading", "Downloading video from Google Drive...")
try:
    import gdown
    gdown.download(
        f"https://drive.google.com/uc?id={file_id}",
        video_path,
        quiet=True,
        fuzzy=True,
    )
    if not os.path.exists(video_path) or os.path.getsize(video_path) < 1000:
        raise RuntimeError("Download failed or file too small")
except Exception as e:
    update_status("error", f"Failed to download video: {e}")
    sys.exit(1)

# Get video duration
try:
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", video_path],
        capture_output=True, text=True
    )
    duration_s = float(json.loads(probe.stdout)["format"]["duration"])
    duration_str = f"{int(duration_s // 60)}m {int(duration_s % 60)}s"
    update_status("downloading", f"Downloaded ({duration_str} video)")
except:
    duration_str = "unknown length"

# ── Step 2: Extract audio ────────────────────────────────────────────────
update_status("transcribing", "Extracting audio...")
try:
    subprocess.run(
        ["ffmpeg", "-i", video_path, "-vn", "-acodec", "libmp3lame", "-q:a", "4", audio_path, "-y"],
        capture_output=True, check=True
    )
except subprocess.CalledProcessError as e:
    update_status("error", f"Failed to extract audio: {e.stderr[:500]}")
    sys.exit(1)

# Free disk space by removing the video file now that we have the audio
try:
    os.remove(video_path)
except:
    pass

# ── Step 3: Transcribe ──────────────────────────────────────────────────
update_status("transcribing", "Transcribing audio with timestamps...")

import asyncio
sys.path.insert(0, os.path.dirname(__file__))

from transcribe_audio import transcribe_audio

async def do_transcribe():
    with open(audio_path, "rb") as f:
        audio_bytes = f.read()
    return await transcribe_audio(
        audio_bytes,
        media_type="audio/mpeg",
        timestamps="word",
        diarize=True,
    )

transcript = asyncio.run(do_transcribe())

# Build readable timestamped transcript
words = transcript.get("words", [])
full_text = transcript.get("text", "")

def format_time(seconds):
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m:02d}:{s:02d}"

transcript_lines = []
current_chunk = []
current_speaker = None
chunk_start = None

for w in words:
    speaker = w.get("speaker_id", "unknown")
    text = w["text"]
    start = w["start"]

    if chunk_start is None:
        chunk_start = start
        current_speaker = speaker

    if speaker != current_speaker or (start - chunk_start > 15 and len(text) > 0 and text[0].isupper()):
        if current_chunk:
            chunk_text = " ".join(current_chunk)
            transcript_lines.append(f"[{format_time(chunk_start)}] {current_speaker}: {chunk_text}")
        current_chunk = [text]
        chunk_start = start
        current_speaker = speaker
    else:
        current_chunk.append(text)

if current_chunk:
    chunk_text = " ".join(current_chunk)
    transcript_lines.append(f"[{format_time(chunk_start)}] {current_speaker}: {chunk_text}")

timestamped_transcript = "\n".join(transcript_lines)

# ── Step 4: Analyze with LLM ────────────────────────────────────────────
update_status("analyzing", "Analyzing transcript and creating segments...")

from anthropic import Anthropic

client = Anthropic()

analysis_prompt = f"""Analyze this full video transcript and break it into meaningful segments of 30–90 seconds, or longer when a single topic continues.

For each segment, output a JSON array where each element has:
- "start": start timestamp (MM:SS)
- "end": end timestamp (MM:SS)
- "shortSummary": short summary (1 line)
- "detailedExplanation": detailed explanation of what is being discussed (2-4 sentences)
- "tags": comma-separated tags
- "clipQualityScore": score from 1-10 (10 = absolute fire content)
- "scoreReason": reason for the score (1-2 sentences)
- "suggestedFormat": one of "short-form clip", "LinkedIn post", "Twitter/X post", "quote graphic", "not useful"

Guidelines for scoring:
- 9-10: Quotable, counter-narrative, universally applicable insights. Would go viral as a clip.
- 7-8: Strong tactical advice with memorable frameworks or metaphors. Good standalone content.
- 5-6: Decent context or setup. Works as part of a longer piece but not standalone.
- 3-4: Introductions, transitions, or filler. Low standalone value.
- 1-2: Off-topic, technical issues, or dead air.

Guidelines for suggested format:
- "short-form clip": Best moments that work as 30-90 second video clips (Reels, TikTok, Shorts)
- "LinkedIn post": Professional insights that work as written thought leadership
- "Twitter/X post": Punchy, quotable one-liners or hot takes
- "quote graphic": Single powerful sentence that works as a text overlay image
- "not useful": Intros, outros, filler, transitions, technical issues

Return ONLY the JSON array, no other text.

TRANSCRIPT:
{timestamped_transcript}"""

message = client.messages.create(
    model="claude_sonnet_4_6",
    max_tokens=8192,
    messages=[{"role": "user", "content": analysis_prompt}],
)

response_text = message.content[0].text.strip()

# Extract JSON from response (handle markdown code blocks)
if response_text.startswith("```"):
    lines = response_text.split("\n")
    json_lines = []
    in_block = False
    for line in lines:
        if line.startswith("```") and not in_block:
            in_block = True
            continue
        elif line.startswith("```") and in_block:
            break
        elif in_block:
            json_lines.append(line)
    response_text = "\n".join(json_lines)

try:
    segments = json.loads(response_text)
except json.JSONDecodeError as e:
    update_status("error", f"Failed to parse LLM response as JSON: {e}")
    sys.exit(1)

# Write result
with open(output_path, "w") as f:
    json.dump(segments, f)

update_status("complete", f"Analysis complete: {len(segments)} segments found")

# Cleanup
import shutil
shutil.rmtree(tmpdir, ignore_errors=True)
