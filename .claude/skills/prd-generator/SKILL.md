---
name: prd-generator
description: "Generate comprehensive Product Requirements Documents with user stories, acceptance criteria, and stakeholder alignment sections. Provides PRD structures by complexity, requirement writing patterns, and dependency mapping frameworks. Use for feature specification, project scoping, or requirements documentation."
---

# PRD Generator

## Overview

Transform product ideas into clear, actionable requirements that engineering teams can build from. This skill encodes the frameworks for writing PRDs that reduce ambiguity and prevent scope creep.

## PRD Structure

### Standard PRD Template

```
TITLE: [Feature Name]
Author: [PM Name] | Status: [Draft/Review/Approved]
Last Updated: [Date]

1. OVERVIEW
   - Problem Statement
   - Proposed Solution
   - Success Metrics

2. CONTEXT
   - Background
   - User Research
   - Competitive Analysis

3. REQUIREMENTS
   - User Stories
   - Functional Requirements
   - Non-Functional Requirements

4. DESIGN
   - User Flows
   - Wireframes/Mockups
   - Technical Considerations

5. SCOPE
   - In Scope
   - Out of Scope
   - Future Considerations

6. TIMELINE
   - Milestones
   - Dependencies
   - Risks

7. APPENDIX
   - Research Data
   - Open Questions
```

## User Story Format

**Template:**
```
As a [user type]
I want to [action]
So that [benefit]
```

**Acceptance Criteria (Given-When-Then):**
```
Given [context]
When [action]
Then [expected result]
```

**Example:**
```
As a sales manager
I want to filter pipeline by stage
So that I can focus on deals ready to close

Acceptance Criteria:
- Given I'm viewing the pipeline
- When I select "Negotiation" stage filter
- Then only deals in Negotiation stage appear
- And the deal count updates to reflect the filter
```

## Requirements Writing

### Functional Requirements

| Component | Guideline |
|-----------|-----------|
| **Action** | Use active verbs (display, calculate, send) |
| **Specificity** | Avoid vague terms (appropriate, reasonable) |
| **Testability** | Must be verifiable |
| **Atomicity** | One requirement per statement |

**Good:** "System shall send email confirmation within 30 seconds of order completion"

**Bad:** "System should send appropriate notifications in a timely manner"

### Non-Functional Requirements

| Category | Examples |
|----------|----------|
| **Performance** | Page load <2s, API response <500ms |
| **Security** | SOC 2 compliance, encryption at rest |
| **Scalability** | Support 10K concurrent users |
| **Availability** | 99.9% uptime SLA |
| **Accessibility** | WCAG 2.1 AA compliance |

## PRD Complexity Tiers

### Tier 1: Small Feature (1-page PRD)
- Bug fix or minor enhancement
- Single user story
- No cross-team dependencies

### Tier 2: Medium Feature (3-5 page PRD)
- New capability
- Multiple user stories
- Some dependencies

### Tier 3: Major Initiative (10+ page PRD)
- New product or major feature
- Complex user flows
- Multiple team dependencies
- Requires architecture review

## Stakeholder Alignment Section

| Stakeholder | Interest | Sign-off Required |
|-------------|----------|-------------------|
| Engineering | Feasibility, effort | Yes |
| Design | UX/UI approach | Yes |
| QA | Test coverage | Yes |
| Legal | Compliance | If applicable |
| Security | Risk assessment | If applicable |

## Resources

### references/
- **user-story-patterns.md** — User story examples by feature type
- **nfr-checklist.md** — Non-functional requirements checklist

### assets/
- **prd-template.docx** — PRD document template
