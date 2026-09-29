export type NoteStyleExample = {
  name: string;
  originalMaterial: string;
  condensedNotes: string;
  demonstrates: string[];
};

// Style transformations only, never subject knowledge for a new Topic.
export const noteStyleExamples: NoteStyleExample[] = [
  {
    name: "Restructuring multiple ideas into one sentence",
    originalMaterial: `Allows programs written in different languages on different platforms to distribute in a standard base manner.

The goal is to provide a platform for building distributed systems using software running on different operating systems and devices, written using programming languages and tools from multiple vendors, all potentially developed and deployed independently.`,
    condensedNotes: "Allows programs/DS written in diff languages, OS to communicate even if deployed independently",
    demonstrates: ["restructuring rather than merely deleting words", "merging several source statements", "removing repeated context", "abbreviations", "retaining the central relationship"],
  },
  {
    name: "Compressing a multi-bullet concept",
    originalMaterial: `DSM simplifies communication between nodes in a distributed system by providing a single, unified memory space.

Instead of passing messages between processes, DSM allows nodes to read and write to shared memory as if accessing local RAM.

Simplifies Programming:
Eliminates the programmer's concern with managing explicit message passing.

Improves Resource Sharing:
Allows large datasets to be shared without duplicating memory on every node.

Reduces Communication Overhead:
Reduces or eliminates message-passing requests.`,
    condensedNotes: `Why use DSM? (4):
Provides single, unified memory space that u can read/write to instead of message passing between processes
Simplifies programming - don’t have to implement message passing
Improves resource sharing - share large dataset without duplicate memory on all nodes
Reduces communication overhead - reduces/eliminates message-passing reqs`,
    demonstrates: ["useful count retained", "repeated prose removed", "term-first structure", "abbreviations", "each important reason retained", "slide wording not preserved unnecessarily"],
  },
  {
    name: "Compact comparison",
    originalMaterial: `Centralised:
A single server manages shared memory.
Access to data only via the central server.
Data all in one place.

Pros:
Simple to manage.
Easier consistency control.

Cons:
Single point of failure.

Distributed:
Memory is spread across multiple nodes but appears as one abstraction.
Each node manages part of the memory.

Pros:
No bottleneck.
Better fault tolerance.

Cons:
Harder to manage consistency.`,
    condensedNotes: "Centralised system - single server stores memory. Advantage is simple to manage, easier to control but single point of failure. DSM doesn’t have bottlenecks and better fault tolerance but harder to maintain consistency.",
    demonstrates: ["comparison compressed into one structure", "headings/bullets do not need to be preserved", "advantages/disadvantages merged", "sentence reordered to remove repetition"],
  },
  {
    name: "Process compression and reordering",
    originalMaterial: `Berkeley Algorithm:

A master polls to collect clock values from the other machines (slaves).

The master uses round trip times to estimate the slaves' clock values.

The master computes the average time in the network.

The master sends the required adjustment to the slaves.

Faulty clock readings can be eliminated by taking a fault-tolerant average.

If the master fails, a new master can be elected.`,
    condensedNotes: "Master/Time-Daemon collects time from slaves using round-trip estimates. Master sends slaves req time adjustments. If master fails, can elect new master. Uses fault-tolerant avg to ignore readings from faulty clocks.",
    demonstrates: ["process compressed without losing ordering/relationships", "clauses rearranged", "obvious abbreviations", "repeated master context reduced", "exception/failure behaviour retained"],
  },
  {
    name: "Comparing related mechanisms",
    originalMaterial: `Push Model:
Advertise services regularly using multicast.
Clients run queries against cached services.

Pull Model:
Clients repeatedly multicast requests.
Devices providing the requested services respond.

Push Model advertising is wasteful.
Pull Model is more efficient, but may need more responses.
A hybrid model may work better.`,
    condensedNotes: `Push model - advertises services regularly (needs to be) w/ multicast. User makes requests based on cached services

Pull model - clients multicast requests & service providers respond.

Push model is wasteful, Pull more efficient but may need more responses. Hybrid may be better.`,
    demonstrates: ["related mechanisms kept together", "direct comparison", "punctuation instead of verbose transitions", "w/ and &", "trade-offs retained"],
  },
  {
    name: "Finite list + compact definitions",
    originalMaterial: `Types of Failures in Distributed Systems:

Crash Failures:
A node completely stops responding, e.g. power failure.

Omission Failures:
Messages are lost or dropped in transmission.

Timing Failures:
A system responds too late or too early.

Byzantine Failures:
A node behaves incorrectly or maliciously.

Network Partitioning:
Some nodes become isolated due to network issues.`,
    condensedNotes: `What are the types of failures in DS? (5)
Crash Failures - node crashes. E.g. power failure
Omission Failures - msgs lost/dropped in transmission
Timing Failures - system responds too late/early
Byzantine Failures - node behaves incorrectly/maliciously
Network Partitioning - some nodes isolated due to network issues`,
    demonstrates: ["useful count", "question-heading style", "term-first definitions", "safe abbreviations", "examples retained only when useful", "aggressive removal of unnecessary prose"],
  },
  {
    name: "Recovery mechanisms",
    originalMaterial: `How Systems Recover After a Failure:

Checkpointing:
Saving the system state periodically so it can be restored after failure.

Rollback Recovery:
Restoring system state from a checkpoint after a failure.

Message Logging:
Storing previous messages for reprocessing after a crash.

Self Healing Systems:
Using Machine Learning to monitor key variables and learn when the data indicates the system is at risk of failure, then resolve it before the failure happens.`,
    condensedNotes: `How do systems recover after a failure? (4)
Checkpointing - saving system periodically so can be restored
Rollback Recovery - rolling back to last saved checkpoint after failure
Message Logging - storing previous msgs for re-processing after crash
Self-Healing Systems - use ML to learn & monitor variables so can detect when failure likely so can be resolved`,
    demonstrates: ["information preserved while grammar is heavily compressed", "sentence fragments", "safe abbreviations", "counts", "clauses reordered to reduce wording"],
  },
  {
    name: "Visuals should sometimes be retained",
    originalMaterial: `A lecture slide contains a visual diagram illustrating clock skew/drift.

Another slide visually demonstrates that machines with independent clocks may assign misleading timestamps, so an event that actually occurred later may appear to have happened earlier.

The surrounding material defines clock skew, clock drift and drift rate.`,
    condensedNotes: `ADD IMAGE FROM SLIDE 8
ADD IMAGE FROM SLIDE 9 - events may be logged on different times
Clock skew - instantaneous difference of two clock times
Clock drift - gradual desynchronisation of independent computer clocks
Drift rate - difference per unit of time from some ideal reference clock`,
    demonstrates: ["not every useful visual should be converted into prose", "retain the visual where it communicates the concept better", "surrounding definitions can still be condensed into text", "visual meaning must not silently disappear"],
  },
];
