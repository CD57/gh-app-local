# gh-app-local

A local Node.js application for interacting with the GitHub API using a GitHub App and private key authentication.

## Features

- Authenticate with GitHub using a private key and App ID
- Make API requests to GitHub
- Easily configurable for local development

## Prerequisites

- Node.js (v14 or higher recommended)
- npm
- A GitHub App with a private key (`private-key.pem`)

## Setup

1. **Clone the repository:**

   ```sh
   git clone https://github.com/CD57/gh-app-local.git
   cd gh-app-local
   ```

2. **Install dependencies:**

   ```sh
   npm install
   ```

3. **Configure your environment:**
   - Place your GitHub App's private key as `private-key.pem` in the project root.
   - Optionally, create a `.env` file for environment variables (see below).

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
GITHUB_APP_ID=your_app_id
GITHUB_INSTALLATION_ID=your_installation_id
GITHUB_PRIVATE_KEY_PATH=private-key.pem
```

## Usage

Run the application:

```sh
node index.js
```

## Project Structure

```text
index.js           # Main application file
package.json       # Project metadata and dependencies
private-key.pem    # GitHub App private key (DO NOT COMMIT)
.env               # Contain GitHub credentials (DO NOT COMMIT)
.gitignore         # Files and folders to ignore in git
```

## Security

- Never commit your `private-key.pem` or sensitive credentials.
- `.gitignore` is configured to exclude secrets and environment files.

## License

This project is licensed under the MIT License.
