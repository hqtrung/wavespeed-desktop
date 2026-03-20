# Skills Usage Guide

This comprehensive guide explains how to effectively use skills in the WaveSpeed Desktop system. Skills are specialized modules that extend Claude's capabilities with specific expertise, tools, and workflows.

## Table of Contents

1. [What are Skills?](#what-are-skills)
2. [Identifying and Activating Skills](#identifying-and-activating-skills)
3. [Different Ways to Use Skills](#different-ways-to-use-skills)
4. [Best Practices for Skill Selection and Usage](#best-practices-for-skill-selection-and-usage)
5. [Common Patterns and Workflows](#common-patterns-and-workflows)
6. [Discovering Available Skills](#discovering-available-skills)
7. [Skill Structure and Anatomy](#skill-structure-and-anatomy)
8. [Troubleshooting and FAQ](#troubleshooting-and-faq)

## What are Skills?

Skills are specialized instruction modules that provide Claude with:
- **Domain expertise** (technical, creative, business-specific knowledge)
- **Tool access** (specialized APIs, external services)
- **Workflow templates** (repeatable processes for common tasks)
- **Context awareness** (project-specific rules and conventions)

### Key Characteristics
- **Self-contained**: Each skill lives in its own directory with a `SKILL.md` file
- **Modular**: Skills can be combined for complex tasks
- **Configurable**: Many skills accept arguments and parameters
- **Specialized**: Each skill focuses on a specific domain or capability

## Identifying and Activating Skills

### 1. System-Recognized Skills

Skills are automatically detected when they follow the naming convention:
- Directory names in `.claude/skills/`
- `SKILL.md` file with YAML frontmatter

### 2. Activation Methods

Skills activate through different mechanisms:

#### Direct Mention
```bash
# Mention skill name directly
"use the pdf skill to extract text from document.pdf"
"apply the brand-guidelines skill to this presentation"
```

#### Slash Commands (Claude.ai)
```bash
# Built-in slash commands
/pdf "extract tables from report.pdf"
/commit "feat: add user authentication"
```

#### Skill Tool (Programmatic Access)
```python
# Use Skill function for programmatic skill activation
skill: "pdf", args: "extract text from document.pdf"
```

#### Automatic Activation
Some skills activate based on:
- File patterns (`.pdf`, `.docx`, etc.)
- Task context (asking for technical architecture)
- System state (development workflow detected)

## Different Ways to Use Skills

### 1. Direct Usage

**Pattern**: `use [skill-name] to [task]`

```bash
# Example commands
"use the ai-multimodal skill to analyze this image"
"use the backend-development skill to review this API design"
"use the ai-artist skill to generate marketing images"
```

**Example with AI Multimodal**:
```bash
# Analyze an image
echo "Describe the technical architecture in this diagram" | python scripts/gemini_batch_process.py --task analyze

# Generate images
python scripts/gemini_batch_process.py --task generate --prompt "futuristic dashboard design"

# Process videos
python scripts/gemini_batch_process.py --files video.mp4 --task analyze --prompt "extract key scenes"
```

### 2. Slash Commands

**Built-in slash commands**:
- `/pdf` - PDF manipulation
- `/commit` - Git commit generation
- `/review-pr` - Pull request review
- `/team` - Team coordination

**Project-specific slash commands**:
- `/bootstrap` - Project scaffolding
- `/ask` - Technical consultation
- `/docs` - Documentation management

### 3. Tool-Based Usage

Use the `Skill` function for programmatic access:

```javascript
// Example: Activate a specific skill
skill: "bootstrap", args: "Build an e-commerce platform"

// Example: Pass additional parameters
skill: "ai-multimodal", args: "analyze image.png --verbose"
```

### 4. Context-Aware Activation

Skills activate automatically when context matches:

```bash
# When asking technical questions
"How should I structure this React component?"
→ Automatically activates backend-development skill

# When working with documents
"Can you extract text from this PDF?"
→ Automatically activates pdf skill

# When starting a new project
"I need to build a new SaaS application"
→ Automatically activates bootstrap skill
```

## Best Practices for Skill Selection and Usage

### 1. Skill Selection Strategy

#### Choose the Right Skill for the Task
- **Technical questions** → `ask` skill for architecture guidance
- **New projects** → `bootstrap` skill for full scaffolding
- **PDF manipulation** → `pdf` skill for document processing
- **Media analysis** → `ai-multimodal` skill for vision/audio/video
- **Code review** → `code-reviewer` skill for quality assessment

#### Match Skill Complexity to Task
- **Simple tasks**: Use built-in slash commands
- **Medium complexity**: Use direct skill mentions
- **Complex projects**: Use bootstrap + planning workflow

### 2. Effective Usage Patterns

#### 1. Clear Task Description
```bash
# Good
"use the ai-multimodal skill to analyze this screenshot for UI design patterns"

# Better
"use the ai-multimodal skill to analyze this design screenshot - identify layout patterns, color schemes, and component hierarchy for a React dashboard"
```

#### 2. Provide Context
```bash
# Include relevant background information
"We're building an e-commerce dashboard with React and TypeScript. Use the backend-development skill to review this API design for scalability and best practices."
```

#### 3. Use Arguments Effectively
```bash
# Pass specific parameters
"use the bootstrap skill to build a SaaS platform with auth and payments --fast"

# Use different modes
"/bootstrap Create a React dashboard with charts and user management --parallel"
```

### 3. Workflow Integration

#### Sequential Workflow
```bash
1. Research phase → Use ask skill for technical guidance
2. Planning phase → Use bootstrap skill for project setup
3. Implementation → Use backend-development skill for code review
4. Testing → Use code-reviewer skill for quality assurance
5. Documentation → Use docs-manager skill for documentation
```

#### Parallel Execution
```bash
# Multiple agents working simultaneously
"Use parallel mode for bootstrap: /bootstrap Build microservices architecture --parallel"
```

## Common Patterns and Workflows

### 1. Project Bootstrapping Workflow

```bash
# Start with bootstrap
/bootstrap "Build a SaaS dashboard with React, TypeScript, and authentication"

# Bootstrap automatically triggers planning
/ck:plan "Build a SaaS dashboard with React, TypeScript, and authentication" --auto

# Planning triggers implementation
/ck:cook ./plans/20250318-1025-saas-dashboard-implementation/ --auto
```

### 2. Technical Consultation Workflow

```bash
# Ask technical questions
/use the ask skill "How should I structure this user authentication system with OAuth2 and JWT?"

# Ask provides architectural guidance
# Follow up with implementation using other skills
/use the backend-development skill to implement the recommended authentication flow
```

### 3. Media Processing Workflow

```bash
# Analyze media content
/use the ai-multimodal skill to analyze this product image for e-commerce optimization

# Generate new media
/use the ai-artist skill to create marketing images based on the analysis

# Process documents
/use the pdf skill to extract product information from catalogs
```

### 4. Code Quality Workflow

```bash
# Review code quality
/use the code-reviewer skill to review this React component for performance and best practices

# Test the implementation
/use the tester skill to run comprehensive unit tests

# Document the results
/use the docs-manager skill to update API documentation
```

## Discovering Available Skills

### 1. Browse Skills Directory

Skills are organized in `.claude/skills/`:

```bash
# List available skills
ls .claude/skills/

# Explore specific skill
ls .claude/skills/ai-multimodal/
```

### 2. Skill Categories

#### Development & Technical
- `backend-development` - API design and backend architecture
- `frontend-development` - Frontend development patterns
- `fullstack-development` - Full-stack development
- `code-reviewer` - Code quality assessment
- `tester` - Testing and validation
- `debugger` - Debugging assistance

#### AI & Machine Learning
- `ai-multimodal` - Multi-modal AI (vision, audio, video)
- `ai-artist` - Creative AI and image generation
- `ask` - Technical consultation

#### Project Management
- `bootstrap` - Project scaffolding
- `planner` - Project planning
- `cook` - Implementation coordination
- `project-manager` - Project lifecycle management

#### Documentation & Content
- `docs-manager` - Documentation management
- `brand-guidelines` - Brand application
- `internal-comms` - Communication templates

#### Specialized Tools
- `pdf` - PDF manipulation
- `chrome-devtools` - Web development debugging
- `mcp-server` - MCP server development

### 3. Skill Metadata

Each skill includes metadata in `SKILL.md`:

```yaml
---
name: skill-name
description: Clear description of what the skill does
argument-hint: "[required-arguments] [--optional-flags]"
license: MIT
allowed-tools: [Bash, Read, Write, Edit]
---
```

### 4. Interactive Discovery

Use natural language to discover skills:

```bash
"What skills are available for web development?"
"Show me skills for image processing"
"Which skills help with project planning?"
```

## Skill Structure and Anatomy

### 1. Skill Directory Structure

```
skill-name/
├── SKILL.md              # Main skill file with metadata and instructions
├── scripts/              # Executable scripts and tools
├── references/           # Documentation and reference materials
├── data/                 # Data files, templates, examples
└── tests/                # Test files and test data
```

### 2. SKILL.md File Structure

```yaml
---
name: skill-name
description: Clear description of what this skill does
argument-hint: "[arguments] [--flags]"
license: MIT
allowed-tools: [Bash, Read, Write, Edit]
---

# Skill Name

Main description and overview of the skill's capabilities.

## Setup

Installation and configuration instructions.

## Usage

Basic usage patterns and examples.

## Arguments and Flags

- `--flag`: Description of optional flag
- `--verbose`: Enable detailed logging
- `--output`: Specify output directory

## Scripts

Available scripts and their purposes.

## Examples

- Example 1: Basic usage
- Example 2: Advanced configuration
- Example 3: Complex workflow

## References

- [Topic 1](references/topic1.md)
- [Topic 2](references/topic2.md)
```

### 3. Skill Arguments and Parameters

#### Required Arguments
```bash
skill: "bootstrap", args: "Build a React dashboard"
```

#### Optional Arguments
```bash
skill: "bootstrap", args: "Build a React dashboard --fast --parallel"
```

#### Multiple Arguments
```bash
skill: "ai-multimodal", args: "analyze image.png --task extract --format json"
```

## Troubleshooting and FAQ

### 1. Common Issues

#### Skill Not Found
```bash
# Problem: Skill doesn't activate
# Solution: Check naming and directory structure
ls .claude/skills/ | grep skill-name
```

#### Missing Dependencies
```bash
# Problem: Skill fails due to missing tools
# Solution: Install dependencies using setup scripts
cd .claude/skills
./install.sh
```

#### Argument Errors
```bash
# Problem: Invalid arguments
# Solution: Check skill documentation
cat .claude/skills/skill-name/SKILL.md
```

### 2. Performance Tips

#### Use Appropriate Skill Modes
```bash
# For quick tasks
/bootstrap "Simple feature" --fast

# For complex projects
/bootstrap "Enterprise system" --full

# For parallel development
/bootstrap "Microservices" --parallel
```

#### Cache and Reuse
```bash
# Some skills cache results for faster execution
# Check skill documentation for caching behavior
cat .claude/skills/ai-multimodal/SKILL.md | grep cache
```

### 3. Best Practices

#### 1. Start Simple
```bash
# Begin with basic usage
/use the pdf skill to extract text

# Then explore advanced features
/use the pdf skill to extract tables with OCR --format json
```

#### 2. Read Documentation
```bash
# Always check skill documentation before use
cat .claude/skills/skill-name/SKILL.md
```

#### 3. Test Incrementally
```bash
# Test with small files first
/use the ai-multimodal skill to analyze small-image.jpg

# Then scale to larger tasks
/use the ai-multimodal skill to analyze large-document.pdf
```

#### 4. Combine Skills
```bash
# Use multiple skills for complex tasks
/use the bootstrap skill to create project structure
/use the backend-development skill to design APIs
/use the frontend-development skill to build UI
/use the code-reviewer skill to ensure quality
```

### 4. Getting Help

#### Interactive Help
```bash
# Ask for skill guidance
"How do I use the ai-multimodal skill effectively?"
"What are the best practices for the bootstrap skill?"
```

#### Documentation Reference
```bash
# Check specific skill documentation
cat .claude/skills/skill-name/SKILL.md

# Browse all skills
ls .claude/skills/
```

#### Community Support
```bash
# Check for examples and patterns
grep -r "skill-name" .claude/skills/references/

# Look for usage examples
find .claude/skills -name "*.md" -exec grep -l "skill-name" {} \;
```

## Summary

Skills provide a powerful way to extend Claude's capabilities with specialized expertise and workflows. By understanding how to identify, activate, and use skills effectively, you can leverage the full potential of the system for your development and creative tasks.

### Key Takeaways
1. **Skills are modular and specialized** - Choose the right skill for your specific task
2. **Multiple activation methods** - Use direct mentions, slash commands, or programmatic access
3. **Context-aware activation** - Skills activate automatically based on your task
4. **Follow best practices** - Use clear descriptions, provide context, and choose appropriate modes
5. **Explore and experiment** - Browse available skills and try different combinations

For the latest skill updates and documentation, always check the `.claude/skills/` directory and individual skill `SKILL.md` files.