"""
Centris CLI - Shell Completion Generation

Provides shell completion scripts for bash, zsh, and fish.
Uses Click's built-in completion support.

Usage:
    # Bash - add to ~/.bashrc
    eval "$(centris completion bash)"
    
    # Zsh - add to ~/.zshrc or save to fpath
    centris completion zsh > ~/.zfunc/_centris
    
    # Fish - save to completions directory
    centris completion fish > ~/.config/fish/completions/centris.fish
"""

import click
import os
import sys
from typing import Optional


# Completion script templates for different shells
BASH_COMPLETION_TEMPLATE = '''
# Centris CLI bash completion
# Add this to ~/.bashrc or source it directly

_centris_completion() {
    local IFS=$'\\n'
    local response

    response=$(env COMP_WORDS="${COMP_WORDS[*]}" COMP_CWORD=$COMP_CWORD _CENTRIS_COMPLETE=bash_complete $1)

    for completion in $response; do
        IFS=',' read type value <<< "$completion"

        if [[ $type == 'dir' ]]; then
            COMPREPLY=()
            compopt -o dirnames
        elif [[ $type == 'file' ]]; then
            COMPREPLY=()
            compopt -o default
        elif [[ $type == 'plain' ]]; then
            COMPREPLY+=($value)
        fi
    done

    return 0
}

_centris_completion_setup() {
    complete -o nosort -F _centris_completion centris
}

_centris_completion_setup;
'''

ZSH_COMPLETION_TEMPLATE = '''#compdef centris

# Centris CLI zsh completion
# Save to ~/.zfunc/_centris and add 'fpath=(~/.zfunc $fpath)' to ~/.zshrc
# Then run: autoload -Uz compinit && compinit

_centris() {
    local -a completions
    local -a completions_with_descriptions
    local -a response
    (( ! $+commands[centris] )) && return 1

    response=("${(@f)$(env COMP_WORDS="${words[*]}" COMP_CWORD=$((CURRENT-1)) _CENTRIS_COMPLETE=zsh_complete centris)}")

    for key descr in ${(kv)response}; do
        if [[ "$descr" == "_" ]]; then
            completions+=("$key")
        else
            completions_with_descriptions+=("$key":"$descr")
        fi
    done

    if [ -n "$completions_with_descriptions" ]; then
        _describe -V unsorted completions_with_descriptions -U
    fi

    if [ -n "$completions" ]; then
        compadd -U -V unsorted -a completions
    fi
}

compdef _centris centris;
'''

FISH_COMPLETION_TEMPLATE = '''# Centris CLI fish completion
# Save to ~/.config/fish/completions/centris.fish

function _centris_completion
    set -l response (env _CENTRIS_COMPLETE=fish_complete COMP_WORDS=(commandline -cp) COMP_CWORD=(commandline -t) centris)

    for completion in $response
        set -l metadata (string split "," -- $completion)

        if [ $metadata[1] = "dir" ]
            __fish_complete_directories $metadata[2]
        else if [ $metadata[1] = "file" ]
            __fish_complete_path $metadata[2]
        else if [ $metadata[1] = "plain" ]
            echo $metadata[2]
        end
    end
end

complete --no-files --command centris --arguments "(_centris_completion)";
'''


def get_completion_script(shell: str) -> str:
    """
    Get the completion script for the specified shell.
    
    Args:
        shell: Shell type - 'bash', 'zsh', or 'fish'
    
    Returns:
        Completion script content
    
    Raises:
        ValueError: If shell is not supported
    """
    shell = shell.lower()
    
    if shell == "bash":
        return BASH_COMPLETION_TEMPLATE.strip()
    elif shell == "zsh":
        return ZSH_COMPLETION_TEMPLATE.strip()
    elif shell == "fish":
        return FISH_COMPLETION_TEMPLATE.strip()
    else:
        raise ValueError(f"Unsupported shell: {shell}. Use bash, zsh, or fish.")


def detect_shell() -> Optional[str]:
    """
    Attempt to detect the current shell.
    
    Returns:
        Shell name or None if detection fails
    """
    shell = os.environ.get("SHELL", "")
    
    if "bash" in shell:
        return "bash"
    elif "zsh" in shell:
        return "zsh"
    elif "fish" in shell:
        return "fish"
    
    return None


def get_completion_install_instructions(shell: str) -> str:
    """
    Get installation instructions for the specified shell.
    
    Args:
        shell: Shell type
    
    Returns:
        Human-readable installation instructions
    """
    shell = shell.lower()
    
    if shell == "bash":
        return """
Bash Completion Installation:

Option 1: Add to ~/.bashrc (immediate effect after restart)
    echo 'eval "$(centris completion bash)"' >> ~/.bashrc
    source ~/.bashrc

Option 2: Save to completions directory (if bash-completion is installed)
    centris completion bash > /etc/bash_completion.d/centris
    # or for user-level:
    centris completion bash > ~/.local/share/bash-completion/completions/centris
"""
    elif shell == "zsh":
        return """
Zsh Completion Installation:

Option 1: Add to ~/.zshrc (immediate effect after restart)
    echo 'eval "$(centris completion zsh)"' >> ~/.zshrc
    source ~/.zshrc

Option 2: Save to fpath (recommended)
    mkdir -p ~/.zfunc
    centris completion zsh > ~/.zfunc/_centris
    # Add to ~/.zshrc if not already present:
    echo 'fpath=(~/.zfunc $fpath)' >> ~/.zshrc
    echo 'autoload -Uz compinit && compinit' >> ~/.zshrc
    source ~/.zshrc
"""
    elif shell == "fish":
        return """
Fish Completion Installation:

Save to fish completions directory (automatic loading):
    mkdir -p ~/.config/fish/completions
    centris completion fish > ~/.config/fish/completions/centris.fish

Completions will be available in new fish sessions.
"""
    else:
        return f"No installation instructions available for {shell}."


@click.command("completion")
@click.argument(
    "shell",
    type=click.Choice(["bash", "zsh", "fish"], case_sensitive=False),
    required=False,
)
@click.option(
    "--install",
    is_flag=True,
    help="Show installation instructions instead of script",
)
def completion_command(shell: Optional[str], install: bool) -> None:
    """
    Generate shell completion script.
    
    Outputs a completion script for the specified SHELL.
    If SHELL is not provided, attempts to detect the current shell.
    
    \b
    Examples:
        centris completion bash          # Output bash completion script
        centris completion zsh           # Output zsh completion script  
        centris completion fish          # Output fish completion script
        centris completion --install     # Show installation instructions
    
    \b
    Quick Setup:
        # Bash
        eval "$(centris completion bash)"
        
        # Zsh
        centris completion zsh > ~/.zfunc/_centris
        
        # Fish
        centris completion fish > ~/.config/fish/completions/centris.fish
    """
    # Auto-detect shell if not provided
    if shell is None:
        shell = detect_shell()
        if shell is None:
            click.echo(
                "Could not detect shell. Please specify: bash, zsh, or fish",
                err=True,
            )
            sys.exit(1)
        click.echo(f"# Detected shell: {shell}", err=True)
    
    shell = shell.lower()
    
    # Show installation instructions if requested
    if install:
        click.echo(get_completion_install_instructions(shell))
        return
    
    # Output the completion script
    try:
        script = get_completion_script(shell)
        click.echo(script)
    except ValueError as e:
        click.echo(str(e), err=True)
        sys.exit(1)


__all__ = [
    "completion_command",
    "get_completion_script",
    "get_completion_install_instructions",
    "detect_shell",
]
