# Chrome Web Store releases

Copy-ready dashboard fields and reviewer instructions live in [store/chrome/submission.md](../store/chrome/submission.md).

The store listing is managed in the [developer dashboard](https://chrome.google.com/webstore/devconsole/10394421-983d-4910-9716-1828882027b8/kmhcfgambmbglmgdjmdlkhcfkfpkddgb/edit).

## Release steps

1. Run the repository checks and the Publish Release workflow on the intended main commit.
2. Download the extension ZIP from that GitHub release and verify its manifest version.
3. Upload the ZIP under Package in the developer dashboard.
4. Review the description, permission justifications and data disclosures in the submission copy against the new package and privacy policy. Save the draft.
5. Submit for review. The 0.3.0 submission kept the existing tester distribution and enabled automatic publication after approval.
6. Verify that the dashboard reports Pending review. Submission does not mean the update is already published.

The MCP server is released separately through the Publish npm package workflow and any approval required on npm's staged packages page.
