**Welcome to the Capstone Project Repo!**

I am using venv to manage my enviroment and using WSL: Ubuntu on VSCode

## Setup Instructions

### Option 1: Automatic Activation with direnv (Recommended)

1. **Install direnv** (one-time setup):
   ```bash
   sudo apt-get install direnv    # Linux/WSL
   # or: brew install direnv       # Mac
   ```

2. **Add to your shell** (one-time setup):
   ```bash
   echo 'eval "$(direnv hook bash)"' >> ~/.bashrc
   source ~/.bashrc
   ```

3. **Allow the project** (first time in this repo):
   ```bash
   cd /path/to/Capstone
   direnv allow
   ```

The virtual environment will now activate automatically when you enter the directory!

### Option 2: Manual Activation

If you prefer not to use direnv:

```bash
# Create venv (first time only)
python3 -m venv venv

# Activate manually each time
source venv/bin/activate
```

### Install Dependencies

#### Option 1: Automatic Setup (Recommended)
```bash
# One-command setup for new team members
./setup_environment.sh
```

#### Option 2: Quick Setup
```bash
# Simple setup
./quick_setup.sh
```

#### Option 3: Manual Setup
```bash
# Create venv
python3 -m venv venv

# Activate venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

**Make Sure to add packages/Imports to requirements!**
