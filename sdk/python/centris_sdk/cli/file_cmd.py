"""
Centris CLI File Commands

File operations directly from the command line.
Read, write, search, and manage files.

Examples:
    centris file read ./package.json
    centris file write ./notes.txt "Hello world"
    centris file list ~/Documents
    centris file search "TODO" --path ./src
"""

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import click

from centris_sdk.cli.theme import theme, symbols
from centris_sdk.cli.progress import Spinner
from centris_sdk.cli.errors import CentrisCLIError, ExitCode


def format_size(size: int) -> str:
    """Format file size in human-readable format."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}TB"


def read_file_contents(path: Path, limit: Optional[int] = None) -> Dict[str, Any]:
    """Read file contents with optional line limit."""
    try:
        if not path.exists():
            return {"success": False, "error": f"File not found: {path}"}
        
        if not path.is_file():
            return {"success": False, "error": f"Not a file: {path}"}
        
        # Check file size
        size = path.stat().st_size
        if size > 10 * 1024 * 1024:  # 10MB limit
            return {
                "success": False,
                "error": f"File too large ({format_size(size)}). Use --limit to read partial.",
            }
        
        content = path.read_text(errors="replace")
        lines = content.split("\n")
        
        if limit and len(lines) > limit:
            lines = lines[:limit]
            content = "\n".join(lines)
            truncated = True
        else:
            truncated = False
        
        return {
            "success": True,
            "path": str(path),
            "content": content,
            "lines": len(lines),
            "size": size,
            "truncated": truncated,
        }
    except PermissionError:
        return {"success": False, "error": f"Permission denied: {path}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def write_file_contents(path: Path, content: str, append: bool = False) -> Dict[str, Any]:
    """Write content to a file."""
    try:
        # Create parent directories if needed
        path.parent.mkdir(parents=True, exist_ok=True)
        
        mode = "a" if append else "w"
        with open(path, mode) as f:
            f.write(content)
        
        return {
            "success": True,
            "path": str(path),
            "size": path.stat().st_size,
            "appended": append,
        }
    except PermissionError:
        return {"success": False, "error": f"Permission denied: {path}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def list_directory(
    path: Path,
    recursive: bool = False,
    pattern: Optional[str] = None,
    show_hidden: bool = False,
) -> Dict[str, Any]:
    """List directory contents."""
    try:
        if not path.exists():
            return {"success": False, "error": f"Directory not found: {path}"}
        
        if not path.is_dir():
            return {"success": False, "error": f"Not a directory: {path}"}
        
        entries = []
        
        if recursive:
            iterator = path.rglob(pattern or "*")
        else:
            iterator = path.glob(pattern or "*")
        
        for entry in iterator:
            if not show_hidden and entry.name.startswith("."):
                continue
            
            try:
                stat = entry.stat()
                entries.append({
                    "name": entry.name,
                    "path": str(entry),
                    "type": "dir" if entry.is_dir() else "file",
                    "size": stat.st_size if entry.is_file() else None,
                    "modified": stat.st_mtime,
                })
            except (PermissionError, OSError):
                continue
        
        # Sort: directories first, then by name
        entries.sort(key=lambda e: (e["type"] != "dir", e["name"].lower()))
        
        return {
            "success": True,
            "path": str(path),
            "entries": entries,
            "count": len(entries),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def search_files(
    path: Path,
    query: str,
    file_pattern: Optional[str] = None,
    max_results: int = 100,
) -> Dict[str, Any]:
    """Search for text in files."""
    try:
        if not path.exists():
            return {"success": False, "error": f"Path not found: {path}"}
        
        results = []
        files_searched = 0
        
        # Compile regex pattern
        try:
            pattern = re.compile(query, re.IGNORECASE)
        except re.error:
            pattern = re.compile(re.escape(query), re.IGNORECASE)
        
        # Determine files to search
        if path.is_file():
            files = [path]
        else:
            files = path.rglob(file_pattern or "*")
        
        for file_path in files:
            if not file_path.is_file():
                continue
            
            # Skip binary files and large files
            try:
                if file_path.stat().st_size > 5 * 1024 * 1024:  # 5MB
                    continue
            except (PermissionError, OSError):
                continue
            
            files_searched += 1
            
            try:
                content = file_path.read_text(errors="replace")
                for i, line in enumerate(content.split("\n"), 1):
                    if pattern.search(line):
                        results.append({
                            "file": str(file_path),
                            "line": i,
                            "content": line.strip()[:200],
                        })
                        
                        if len(results) >= max_results:
                            return {
                                "success": True,
                                "results": results,
                                "files_searched": files_searched,
                                "truncated": True,
                            }
            except (PermissionError, UnicodeDecodeError):
                continue
        
        return {
            "success": True,
            "results": results,
            "files_searched": files_searched,
            "truncated": False,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# =============================================================================
# File Command Group
# =============================================================================

@click.group(name="file")
@click.pass_context
def file_group(ctx: click.Context):
    """
    File operations.
    
    Read, write, list, and search files from the command line.
    
    \b
    Examples:
      centris file read ./package.json
      centris file write ./notes.txt "Hello world"
      centris file list ~/Documents
      centris file search "TODO" --path ./src
    
    \b
    Docs: https://docs.centris.ai/sdk/cli/file
    """
    ctx.ensure_object(dict)


@file_group.command(name="read")
@click.argument("path", type=click.Path())
@click.option("--limit", "-n", type=int, help="Limit output to N lines")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def read_command(ctx: click.Context, path: str, limit: Optional[int], json_output: bool):
    """
    Read file contents.
    
    \b
    Examples:
      centris file read ./package.json
      centris file read ~/notes.txt --limit 50
      centris file read config.yaml --json
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    
    file_path = Path(path).expanduser().resolve()
    result = read_file_contents(file_path, limit=limit)
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    else:
        if result.get("success"):
            content = result.get("content", "")
            click.echo(content)
            
            if result.get("truncated"):
                click.echo(f"\n{theme.muted(f'... truncated at {limit} lines')}")
        else:
            click.echo(f"{theme.error(symbols.CROSS)} {result.get('error')}")
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


@file_group.command(name="write")
@click.argument("path", type=click.Path())
@click.argument("content", required=False)
@click.option("--append", "-a", is_flag=True, help="Append instead of overwrite")
@click.option("--stdin", is_flag=True, help="Read content from stdin")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def write_command(
    ctx: click.Context,
    path: str,
    content: Optional[str],
    append: bool,
    stdin: bool,
    json_output: bool,
):
    """
    Write content to a file.
    
    \b
    Examples:
      centris file write ./notes.txt "Hello world"
      centris file write ./log.txt "New entry" --append
      echo "content" | centris file write ./file.txt --stdin
    """
    import sys as _sys
    
    json_output = json_output or ctx.obj.get("json_output", False)
    
    # Get content from stdin if requested
    if stdin or (not content and not _sys.stdin.isatty()):
        content = _sys.stdin.read()
    
    if not content:
        click.echo(theme.error("Error: No content provided"))
        click.echo(theme.muted("Usage: centris file write <path> \"content\""))
        ctx.exit(ExitCode.ERROR)
    
    file_path = Path(path).expanduser().resolve()
    result = write_file_contents(file_path, content, append=append)
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    else:
        if result.get("success"):
            action = "Appended to" if append else "Wrote"
            size = format_size(result.get("size", 0))
            click.echo(f"{theme.success(symbols.CHECK)} {action}: {file_path} ({size})")
        else:
            click.echo(f"{theme.error(symbols.CROSS)} {result.get('error')}")
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


@file_group.command(name="list")
@click.argument("path", type=click.Path(), default=".")
@click.option("--recursive", "-r", is_flag=True, help="List recursively")
@click.option("--pattern", "-p", help="Glob pattern to filter files")
@click.option("--hidden", "-a", is_flag=True, help="Show hidden files")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def list_command(
    ctx: click.Context,
    path: str,
    recursive: bool,
    pattern: Optional[str],
    hidden: bool,
    json_output: bool,
):
    """
    List directory contents.
    
    \b
    Examples:
      centris file list
      centris file list ~/Documents
      centris file list ./src --recursive --pattern "*.py"
      centris file list -a  # Show hidden files
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    
    dir_path = Path(path).expanduser().resolve()
    result = list_directory(dir_path, recursive=recursive, pattern=pattern, show_hidden=hidden)
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    else:
        if result.get("success"):
            entries = result.get("entries", [])
            
            for entry in entries:
                name = entry["name"]
                entry_type = entry["type"]
                size = entry.get("size")
                
                if entry_type == "dir":
                    click.echo(f"  {theme.accent('📁')} {name}/")
                else:
                    size_str = format_size(size) if size else ""
                    click.echo(f"  {theme.muted('📄')} {name}  {theme.muted(size_str)}")
            
            click.echo(f"\n{theme.muted(f'{len(entries)} items')}")
        else:
            click.echo(f"{theme.error(symbols.CROSS)} {result.get('error')}")
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


@file_group.command(name="search")
@click.argument("query")
@click.option("--path", "-p", type=click.Path(), default=".", help="Path to search in")
@click.option("--pattern", "-g", help="File glob pattern (e.g., *.py)")
@click.option("--max", "-m", type=int, default=100, help="Maximum results")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def search_command(
    ctx: click.Context,
    query: str,
    path: str,
    pattern: Optional[str],
    max: int,
    json_output: bool,
):
    """
    Search for text in files.
    
    \b
    Examples:
      centris file search "TODO"
      centris file search "import" --path ./src --pattern "*.py"
      centris file search "error" --max 50
    """
    json_output = json_output or ctx.obj.get("json_output", False)
    
    search_path = Path(path).expanduser().resolve()
    
    if not json_output:
        with Spinner(f"Searching for: {query}...") as spinner:
            result = search_files(search_path, query, file_pattern=pattern, max_results=max)
            if result.get("success"):
                count = len(result.get("results", []))
                spinner.success(f"Found {count} matches")
            else:
                spinner.fail(result.get("error", "Search failed"))
    else:
        result = search_files(search_path, query, file_pattern=pattern, max_results=max)
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    else:
        if result.get("success"):
            results = result.get("results", [])
            
            if results:
                current_file = None
                for match in results:
                    file_path = match["file"]
                    if file_path != current_file:
                        current_file = file_path
                        click.echo(f"\n{theme.heading(file_path)}")
                    
                    line_num = match["line"]
                    content = match["content"]
                    click.echo(f"  {theme.accent(f'{line_num}:')} {content}")
                
                if result.get("truncated"):
                    click.echo(f"\n{theme.warn('!')} Results truncated at {max}")
            else:
                click.echo(f"{theme.muted('No matches found')}")
        else:
            click.echo(f"{theme.error(symbols.CROSS)} {result.get('error')}")
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


@file_group.command(name="delete")
@click.argument("path", type=click.Path())
@click.option("--force", "-f", is_flag=True, help="Don't prompt for confirmation")
@click.option("--recursive", "-r", is_flag=True, help="Delete directories recursively")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.pass_context
def delete_command(
    ctx: click.Context,
    path: str,
    force: bool,
    recursive: bool,
    json_output: bool,
):
    """
    Delete a file or directory.
    
    \b
    Examples:
      centris file delete ./temp.txt
      centris file delete ./cache --recursive
      centris file delete ./file.txt --force
    """
    import shutil
    
    json_output = json_output or ctx.obj.get("json_output", False)
    
    file_path = Path(path).expanduser().resolve()
    
    if not file_path.exists():
        result = {"success": False, "error": f"Path not found: {file_path}"}
        if json_output:
            click.echo(json.dumps(result, indent=2))
        else:
            click.echo(f"{theme.error(symbols.CROSS)} {result['error']}")
        ctx.exit(ExitCode.ERROR)
    
    # Confirm deletion
    if not force and not json_output:
        if file_path.is_dir():
            if not recursive:
                click.echo(f"{theme.error(symbols.CROSS)} Cannot delete directory without --recursive")
                ctx.exit(ExitCode.ERROR)
            prompt = f"Delete directory {file_path} and all contents?"
        else:
            prompt = f"Delete {file_path}?"
        
        if not click.confirm(prompt):
            click.echo(f"{theme.muted('Cancelled')}")
            ctx.exit(ExitCode.CANCELLED)
    
    try:
        if file_path.is_dir():
            if recursive:
                shutil.rmtree(file_path)
            else:
                file_path.rmdir()
        else:
            file_path.unlink()
        
        result = {"success": True, "path": str(file_path), "deleted": True}
    except PermissionError:
        result = {"success": False, "error": f"Permission denied: {file_path}"}
    except Exception as e:
        result = {"success": False, "error": str(e)}
    
    if json_output:
        click.echo(json.dumps(result, indent=2))
    else:
        if result.get("success"):
            click.echo(f"{theme.success(symbols.CHECK)} Deleted: {file_path}")
        else:
            click.echo(f"{theme.error(symbols.CROSS)} {result.get('error')}")
    
    if not result.get("success"):
        ctx.exit(ExitCode.ERROR)


__all__ = ["file_group"]
