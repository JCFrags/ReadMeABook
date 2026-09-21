# ReadMeABook, JCFrags fork

This fork modifies upstream ReadMeABook v1.2.3. See [fork scope and deployment](FORK.md). Changes began on September 21, 2026. The original AGPL-3.0 license and upstream notices remain in place. This is not an official upstream release.

[Corresponding source](https://github.com/JCFrags/ReadMeABook) · [Upstream project](https://github.com/kikootwo/ReadMeABook)

<div align="center">

![RMAB_hero.png](screenshots/RMAB_hero.png)

### Audiobook automation for Plex and Audiobookshelf

<div align="center">

  [![Ko-Fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/kikootwo)
  [![GitHub Sponsors](https://img.shields.io/github/sponsors/kikootwo?style=for-the-badge&logo=github&logoColor=white&label=Sponsor&color=EA4AAA)](https://github.com/sponsors/kikootwo)
  [![Build Status](https://img.shields.io/github/actions/workflow/status/kikootwo/readmeabook/build-unified-image.yml?branch=main&style=for-the-badge&logo=github&label=Build)](https://github.com/kikootwo/readmeabook/actions/workflows/build-unified-image.yml)
  [![Tests](https://img.shields.io/github/actions/workflow/status/kikootwo/readmeabook/run-tests.yml?branch=main&style=for-the-badge&logo=github&label=Tests)](https://github.com/kikootwo/readmeabook/actions/workflows/run-tests.yml)
  [![Docker Pulls](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fghcr-badge.elias.eu.org%2Fapi%2Fkikootwo%2Freadmeabook%2Freadmeabook&query=downloadCount&style=for-the-badge&logo=docker&label=Docker%20Pulls&color=2496ed)](https://github.com/kikootwo/readmeabook/pkgs/container/readmeabook)
  [![License](https://img.shields.io/badge/License-AGPL%20v3-blue.svg?style=for-the-badge)](https://www.gnu.org/licenses/agpl-3.0)
  [![GitHub Stars](https://img.shields.io/github/stars/kikootwo/readmeabook?style=for-the-badge&logo=github)](https://github.com/kikootwo/readmeabook/stargazers)
  [![Discord](https://img.shields.io/discord/1450562177277755464?style=for-the-badge&logo=discord&logoColor=white&label=Discord)](https://discord.gg/kaw6jKbKts)
</div>

*Radarr/Sonarr + Overseerr for audiobooks, all in one*

[Features](#features) • [Setup](#setup) • [Screenshots](#screenshots) • [Discord](#community)

</div>

---

## What is this?

You run Plex or Audiobookshelf with audiobooks. You want more audiobooks. You search indexers, download torrents or NZBs, organize files, wait for your server to scan. ReadMeABook does all of that automatically.

Request a book → Prowlarr searches → qBittorrent or SABnzbd downloads → Files organized → Library imports. Done.

Also includes BookDate: AI recommendations with a Tinder-style swipe interface. Swipe right to request.

User friendly audible-backed searches, multi-file chapter merging, e-book sidecar support, OIDC OAuth, admin approval workflows, and more.

## Features

- **Plex** or **Audiobookshelf**
- **Torrents** via qBittorrent
- **Usenet** via SABnzbd
- **Prowlarr** for indexer search (torrents + NZBs)
- **BookDate**: AI recommendations (OpenAI/Claude/Local) with swipe interface
- **Chapter merging**: Multi-file downloads → single M4B with chapters
- **E-book sidecar**: Optional EPUB/PDF downloads from Shadow Library
- **Request approval**: Admin approval workflow for multi-user setups
- **Setup wizard**: Step-by-step guided config with connection testing

## Setup

**Prerequisites:** Docker, Plex or Audiobookshelf, qBittorrent or SABnzbd, Prowlarr

### Quick Start

```bash
# Download docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/kikootwo/readmeabook/main/docker-compose.yml -o docker-compose.yml

# Start the container
docker compose up -d
```

Open http://localhost:3030 and follow the setup wizard.

### Manual Setup

If you prefer to customize the compose file:

```yaml
services:
  readmeabook:
    image: ghcr.io/kikootwo/readmeabook:latest
    container_name: readmeabook
    restart: unless-stopped
    ports:
      - "3030:3030"
    volumes:
      - ./config:/app/config
      - ./cache:/app/cache
      - ./downloads:/downloads        # Your download client's path
      - ./media:/media                # Your audiobook library
      - ./pgdata:/var/lib/postgresql/data
      - ./redis:/var/lib/redis
    environment:
      PUID: 1000                      # Optional: your user ID
      PGID: 1000                      # Optional: your group ID
      PUBLIC_URL: "https://audiobooks.example.com"  # Required for OAuth
```

Then run `docker compose up -d` to start.

**Important:** Your download client (qBittorrent/SABnzbd) and RMAB must see files at the same path. See the [Volume Mapping Guide](documentation/deployment/volume-mapping.md) if downloads aren't being detected.

## Screenshots

<img WIDTH="720" alt="image" src="screenshots/HOMEPAGE.png" />
<img WIDTH="720" alt="image" src="screenshots/ADMIN.png" />
<img WIDTH="720" alt="image" src="screenshots/BOOKDATE.png" />

## Community

Join the Discord: https://discord.gg/kaw6jKbKts

Feature and fix Contributions are highly welcome. Documentation in `documentation/` if you want to contribute. Discord is a great place to ask questions!

## Support

If you find this project useful, consider supporting development via [GitHub Sponsors](https://github.com/sponsors/kikootwo) or [Ko-fi](https://ko-fi.com/kikootwo).

If you'd like to support but cannot sponsor, a simple star on the GitHub repo is also greatly appreciated!

## Built with AI Assistance

This is a human-engineered application. Architecture, design decisions, code review, and project direction are managed by a principal engineer with nearly 15 years of professional software development experience.

AI tools (Claude, GitHub Copilot) serve as force multipliers. Accelerating implementation, maintaining consistency, and handling boilerplate, while human expertise drives the technical vision. This mirrors how AI assistance is used at leading technology companies today.

**The workflow:**
- Token-optimized documentation system designed for AI consumption ([CLAUDE.md](CLAUDE.md))
- Structured navigation enabling AI to find relevant context without reading entire codebases
- Consistent architectural patterns that AI tools can follow and extend
- Human review of all AI-generated code before merge

The result: enterprise-grade velocity on a solo project without sacrificing code quality or architectural integrity.

---

<div align="center">

**AGPL v3 License**

</div>
