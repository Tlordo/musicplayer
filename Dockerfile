FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src src
COPY public public
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages "yt-dlp[default]" \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/musicplayer /usr/local/bin/musicplayer
WORKDIR /data
ENV HOST=0.0.0.0 PORT=3000 MUSIC_DATA_DIR=/data/Data MUSIC_DB=/data/database.db
EXPOSE 3000
VOLUME /data
CMD ["musicplayer"]
